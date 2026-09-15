'use strict';
const { app, BrowserWindow, protocol, net, ipcMain, utilityProcess, dialog, shell, clipboard, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { EventStore, atomicWrite, validateState, publicState, selectRecovery } = require('./event-store.cjs');
const { assetPath } = require('./lan-server.cjs');
const { Supervisor } = require('./supervisor.cjs');
const { networkInfo } = require('./network-addresses.cjs');

const ROOT = path.join(__dirname, '..', 'gala');
const ORIGIN = 'fundraiser://app';
const testing = !app.isPackaged && process.argv.includes('--test-mode');
const dataArg = testing && process.argv.find(value => value.startsWith('--test-data='));
if (dataArg) app.setPath('userData', dataArg.slice('--test-data='.length));
const customData = process.argv.find(value => value.startsWith('--data-dir='));
if (customData) {
  const directory = customData.slice('--data-dir='.length);
  if (!path.isAbsolute(directory)) throw new Error('The data directory must be an absolute path.');
  app.setPath('userData', directory);
}
protocol.registerSchemesAsPrivileged([{ scheme: 'fundraiser', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let controller, audience, store, supervisor, state, loadError = '', savedAt = null;
let quitting = false;
let code = crypto.randomInt(10000).toString().padStart(4, '0');

function status() {
  const { urls } = networkInfo();
  return { server: supervisor?.status || 'stopped', error: supervisor?.error || '', code, urls,
    viewers: supervisor?.viewers || 0, savedAt, directory: store?.directory };
}
function notify() {
  if (controller && !controller.isDestroyed()) controller.webContents.send('fundraiser:status', status());
}
function trusted(event) {
  return controller && event.sender === controller.webContents && event.senderFrame === controller.webContents.mainFrame
    && event.senderFrame.url === ORIGIN + '/index.html';
}
function handle(name, action) {
  ipcMain.handle('fundraiser:' + name, (event, ...args) => {
    if (!trusted(event)) throw new Error('This action is only available in the controller.');
    return action(...args);
  });
}
function save(next) {
  if (loadError) throw new Error(loadError);
  store.save(next);
  state = structuredClone(next);
  savedAt = Date.now();
  supervisor.send('state', publicState(state));
  notify();
  return { savedAt };
}
function openAudience() {
  if (audience && !audience.isDestroyed()) return audience.focus();
  audience = new BrowserWindow({ width: 1280, height: 720, title: 'Audience screen', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  audience.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  audience.webContents.on('will-navigate', event => event.preventDefault());
  audience.loadURL(ORIGIN + '/audience.html#local=1');
}
async function exportEvent(current = state) {
  validateState(current);
  const result = await dialog.showSaveDialog(controller, { defaultPath: 'fundraising-event.json', filters: [{ name: 'Fundraising event', extensions: ['json'] }] });
  if (!result.canceled && result.filePath) atomicWrite(result.filePath, JSON.stringify(current, null, 2));
  return !result.canceled;
}
async function importEvent() {
  const result = await dialog.showOpenDialog(controller, { properties: ['openFile'], filters: [{ name: 'Fundraising event', extensions: ['json'] }] });
  if (result.canceled) return null;
  if (fs.statSync(result.filePaths[0]).size > 20 * 1024 * 1024) throw new Error('Event files must be smaller than 20 MB.');
  const next = validateState(JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')));
  const answer = await dialog.showMessageBox(controller, { type: 'question', buttons: ['Cancel', 'Import event'], defaultId: 0, cancelId: 0,
    message: 'Replace the current event?', detail: 'The existing event will be archived first. The imported file includes ' + next.donations.length + ' gifts.' });
  if (answer.response !== 1) return null;
  store.archive(state);
  if (loadError) store.preserveUnreadable();
  loadError = '';
  next.rev = Math.max(Date.now(), (Number(state?.rev) || 0) + 1);
  next.stage = null;
  save(next);
  return next;
}

function registerControls() {
  handle('load', () => ({ state, error: loadError, recovered: store.recovered, status: status() }));
  handle('recover', cached => {
    if (loadError) throw new Error(loadError);
    const next = selectRecovery(state, cached);
    return { state: next, recovered: next !== state };
  });
  handle('save', save);
  handle('status', status);
  handle('restart', () => supervisor.restart());
  handle('new-code', async () => {
    let next;
    do { next = crypto.randomInt(10000).toString().padStart(4, '0'); } while (next === code);
    code = next;
    supervisor.options.code = code;
    supervisor.options.secret = crypto.randomBytes(32).toString('hex');
    await supervisor.restart();
    return code;
  });
  handle('celebrate', type => { if (['confetti', 'balloons', 'fireworks', 'all'].includes(type)) supervisor.send('celebrate', { type }); });
  handle('open-audience', openAudience);
  handle('copy-link', () => { const url = status().urls[0]; if (url) clipboard.writeText(url); return url || ''; });
  handle('export-event', exportEvent);
  handle('import-event', importEvent);
  handle('archive', () => store.archive(state));
  handle('open-data', () => shell.openPath(store.directory));
  handle('csv', async text => {
    if (typeof text !== 'string' || text.length > 20 * 1024 * 1024) throw new Error('Invalid CSV file.');
    atomicWrite(path.join(store.directory, 'donations.csv'), '\ufeff' + text);
    return true;
  });
  handle('diagnostics', async () => {
    const result = await dialog.showSaveDialog(controller, { defaultPath: 'connection-report.json' });
    if (!result.canceled) atomicWrite(result.filePath, JSON.stringify({ version: app.getVersion(), platform: process.platform,
      server: supervisor.status, error: supervisor.error, viewers: supervisor.viewers, savedAt, network: networkInfo() }, null, 2));
  });
  if (testing) handle('test-stop-server', () => supervisor.worker?.kill());
}

async function start() {
  app.setName('Fundraising Display');
  store = new EventStore(path.join(app.getPath('userData'), 'events'));
  try { state = store.load(); } catch (error) { loadError = error.message; }
  if (state) state.stage = null;
  supervisor = new Supervisor(() => utilityProcess.fork(path.join(__dirname, 'server-worker.cjs'), [], { serviceName: 'Projector connection' }),
    { root: ROOT, code, secret: crypto.randomBytes(32).toString('hex'), state: publicState(state) });
  supervisor.on('status', notify);
  protocol.handle('fundraiser', async request => {
    const url = new URL(request.url);
    const file = url.host === 'app' && assetPath(ROOT, url.pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(file).toString());
    response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'");
    return response;
  });
  app.on('web-contents-created', (_, contents) => {
    contents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
    contents.on('will-attach-webview', event => event.preventDefault());
  });
  registerControls();
  controller = new BrowserWindow({ width: 1440, height: 940, minWidth: 900, minHeight: 640, title: 'Fundraising Display', show: false, icon: path.join(ROOT, 'assets/app-icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  controller.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  controller.webContents.on('will-navigate', event => event.preventDefault());
  controller.once('ready-to-show', () => controller.show());
  controller.on('close', event => {
    if (quitting || testing) return;
    if (dialog.showMessageBoxSync(controller, { type: 'question', buttons: ['Keep running', 'Exit app'], defaultId: 0, cancelId: 0,
      message: 'End this session?', detail: 'Closing the app stops the projector connection. Saved donations remain on this laptop.' }) !== 1) event.preventDefault();
  });
  controller.on('closed', () => app.quit());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'Event', submenu: [{ label: 'Open audience screen', click: openAudience }, { label: 'Restart server', click: () => supervisor.restart() }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'resetZoom' }] }
  ]));
  await controller.loadURL(ORIGIN + '/index.html');
  supervisor.start();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (controller) { if (controller.isMinimized()) controller.restore(); controller.focus(); } });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('Unable to start', error.message); app.quit(); });
}
app.on('before-quit', () => { quitting = true; supervisor?.stop(); });
app.on('window-all-closed', () => app.quit());
