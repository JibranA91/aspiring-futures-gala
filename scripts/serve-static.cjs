'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { assetPath } = require('../desktop/lan-server.cjs');
const root = path.join(__dirname, '..', 'gala');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = assetPath(root, pathname === '/' ? '/index.html' : pathname);
  res.setHeader('Cache-Control', 'no-store');
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}).listen(8080, '127.0.0.1');
