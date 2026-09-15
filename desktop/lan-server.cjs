'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

async function portInUse(port) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = busy => { socket.destroy(); resolve(busy); };
    socket.setTimeout(1500, () => done(true));
    socket.once('connect', () => done(true));
    socket.once('error', error => done(error.code !== 'ECONNREFUSED'));
  });
}

function assetPath(root, pathname) {
  let name;
  try { name = decodeURIComponent(pathname); } catch { return null; }
  if (name.includes('\\') || name.includes('\0')) return null;
  const target = path.resolve(root, '.' + name);
  return target.startsWith(path.resolve(root) + path.sep) ? target : null;
}

class LANServer {
  constructor({ root, code, secret, state, onPresence = () => {} }) {
    Object.assign(this, { root, code, secret, state, onPresence });
    this.clients = new Set();
    this.attempts = new Map();
  }
  async start(port = 8080, host = '0.0.0.0') {
    if (port && await portInUse(port)) throw Object.assign(new Error('Port is already in use'), { code: 'EADDRINUSE' });
    this.server = http.createServer((req, res) => this.handle(req, res).catch(() => {
      if (!res.headersSent) this.json(res, 500, { error: 'The connection could not be completed.' });
      else res.end();
    }));
    this.server.requestTimeout = 15000;
    this.server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen({ port, host, exclusive: true }, () => { this.server.removeListener('error', reject); resolve(); });
    });
    this.server.on('error', () => {});
    this.heartbeat = setInterval(() => {
      this.send('presence', { role: 'controller', t: Date.now() });
      this.onPresence(this.clients.size);
    }, 2000);
    return this.server.address().port;
  }
  json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  token() {
    const data = Buffer.from(JSON.stringify({ exp: Date.now() + 24 * 60 * 60 * 1000, nonce: crypto.randomBytes(16).toString('hex') })).toString('base64url');
    return data + '.' + crypto.createHmac('sha256', this.secret).update(data).digest('base64url');
  }
  authorized(token) {
    if (typeof token !== 'string' || token.length > 400) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [data, signature] = parts;
    if (!data || !signature) return false;
    const expected = crypto.createHmac('sha256', this.secret).update(data).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    try { return JSON.parse(Buffer.from(data, 'base64url')).exp > Date.now(); } catch { return false; }
  }
  async pair(req, res) {
    if (req.headers.origin !== 'http://' + req.headers.host) return this.json(res, 403, { error: 'Open the projector link shown in the app.' });
    const ip = req.socket.remoteAddress;
    const now = Date.now();
    for (const [key, value] of this.attempts) if (now - value.start > 60000) this.attempts.delete(key);
    const attempt = this.attempts.get(ip) || { start: now, count: 0 };
    if (attempt.count >= 5 || this.attempts.size > 1000) return this.json(res, 429, { error: 'Too many attempts. Wait one minute and try again.' });
    attempt.count++;
    this.attempts.set(ip, attempt);
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 256) return this.json(res, 413, { error: 'Invalid pairing request.' });
    }
    let code;
    try { code = JSON.parse(body).code; } catch {}
    if (code !== this.code) return this.json(res, 401, { error: 'That code does not match. Check the controller.' });
    this.json(res, 200, { token: this.token() });
  }
  async handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'none'");
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/pair' && req.method === 'POST') return this.pair(req, res);
    if (req.method !== 'GET') return this.json(res, 405, { error: 'Not allowed.' });
    if (url.pathname === '/api/health') return this.json(res, 200, { ok: true });
    if (url.pathname === '/api/session') return this.json(res, this.authorized(url.searchParams.get('token')) ? 200 : 401, {});
    if (url.pathname === '/api/events') {
      if (!this.authorized(url.searchParams.get('token'))) return this.json(res, 401, { error: 'Pair again with the current code.' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write('retry: 1200\n\n');
      this.clients.add(res);
      if (this.state) this.event(res, 'snapshot', { ...this.state, stage: null });
      this.event(res, 'presence', { role: 'controller', t: Date.now() });
      this.onPresence(this.clients.size);
      req.on('close', () => { this.clients.delete(res); this.onPresence(this.clients.size); });
      return;
    }
    if (url.pathname === '/lan-config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end('window.FundraiserLAN = true;');
    }
    const pathname = url.pathname === '/' || url.pathname === '/index.html' ? '/audience.html' : url.pathname;
    if (!(pathname === '/audience.html' || /^\/(js|ds|assets)\//.test(pathname)) || pathname === '/js/controller.js') {
      return this.json(res, 404, { error: 'Not found.' });
    }
    const file = assetPath(this.root, pathname);
    if (!file || !TYPES[path.extname(file)] || !fs.existsSync(file) || !fs.statSync(file).isFile()) return this.json(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
  event(res, kind, body) {
    res.write('data: ' + JSON.stringify({ kind, body }) + '\n\n');
    if (res.writableLength > 32 * 1024 * 1024) {
      this.clients.delete(res);
      res.end();
    }
  }
  send(kind, body) {
    if (kind === 'state') this.state = body;
    for (const client of this.clients) this.event(client, kind, body);
  }
  async stop() {
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.end();
    this.clients.clear();
    if (!this.server?.listening) return;
    await new Promise(resolve => { this.server.close(resolve); this.server.closeAllConnections(); });
  }
}

module.exports = { LANServer, assetPath };
