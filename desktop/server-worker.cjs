'use strict';
const { LANServer } = require('./lan-server.cjs');
const port = process.parentPort;
let server;
port.on('message', async ({ data }) => {
  try {
    if (data.type === 'start') {
      server = new LANServer({ ...data.options, onPresence: count => port.postMessage({ type: 'presence', count }) });
      await server.start(data.port);
      port.postMessage({ type: 'ready' });
    }
    if (data.type === 'send') server?.send(data.kind, data.body);
    if (data.type === 'ping') port.postMessage({ type: 'pong' });
  } catch (error) { port.postMessage({ type: 'error', message: error.message, code: error.code }); }
});
