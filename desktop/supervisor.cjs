'use strict';
const { EventEmitter } = require('node:events');

class Supervisor extends EventEmitter {
  constructor(spawn, options) {
    super();
    this.spawn = spawn;
    this.options = options;
    this.status = 'stopped';
    this.error = '';
    this.retries = 0;
    this.viewers = 0;
  }
  report(status, error = '') {
    this.status = status;
    this.error = error;
    this.emit('status');
  }
  start() {
    if (this.worker) return;
    clearTimeout(this.retry);
    this.report('starting');
    const worker = this.spawn();
    this.worker = worker;
    this.pongAt = Date.now();
    worker.on('message', data => {
      if (this.worker !== worker) return;
      if (data.type === 'ready') this.report('running');
      if (data.type === 'pong') this.pongAt = Date.now();
      if (data.type === 'presence') { this.viewers = data.count; this.emit('status'); }
      if (data.type === 'error') this.failed(data.code === 'EADDRINUSE'
        ? 'Port 8080 is in use. Close the old launcher or other app using it, then click Restart server.' : data.message, data.code !== 'EADDRINUSE');
    });
    worker.on('exit', () => { if (this.worker === worker) this.failed('The connection server stopped unexpectedly.', true); });
    worker.postMessage({ type: 'start', options: this.options, port: 8080 });
    this.watch = setInterval(() => {
      if (Date.now() - this.pongAt > 12000) return this.failed('The connection server stopped responding.', true);
      worker.postMessage({ type: 'ping' });
    }, 3000);
  }
  failed(message, retry) {
    this.stop();
    this.report('failed', message);
    if (retry && this.retries++ < 3) this.retry = setTimeout(() => this.start(), 1500 * this.retries);
  }
  stop() {
    clearInterval(this.watch);
    clearTimeout(this.retry);
    const worker = this.worker;
    this.worker = null;
    if (worker) worker.kill();
    this.viewers = 0;
    this.report('stopped');
  }
  async restart() {
    const worker = this.worker;
    const exited = worker ? new Promise(resolve => worker.once('exit', resolve)) : Promise.resolve();
    this.stop();
    await exited;
    this.retries = 0;
    this.start();
  }
  send(kind, body) {
    if (kind === 'state') this.options.state = body;
    if (this.worker) this.worker.postMessage({ type: 'send', kind, body });
  }
}
module.exports = { Supervisor };
