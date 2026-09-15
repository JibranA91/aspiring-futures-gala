'use strict';
const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame && location.href === 'fundraiser://app/index.html') {
  const call = name => (...args) => ipcRenderer.invoke('fundraiser:' + name, ...args);
  contextBridge.exposeInMainWorld('fundraiserDesktop', {
    load: call('load'), recover: call('recover'), save: call('save'), status: call('status'), restart: call('restart'), newCode: call('new-code'),
    celebrate: call('celebrate'), openAudience: call('open-audience'), copyLink: call('copy-link'),
    exportEvent: call('export-event'), importEvent: call('import-event'), archive: call('archive'),
    openData: call('open-data'), csv: call('csv'), diagnostics: call('diagnostics'),
    onStatus: callback => {
      const listener = (_, value) => callback(value);
      ipcRenderer.on('fundraiser:status', listener);
      return () => ipcRenderer.removeListener('fundraiser:status', listener);
    }
  });
}
