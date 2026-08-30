// Dependency-free static server for the web build (npm run web).
//
// Serves src/ as-is - there is no build step, the renderer is native ES
// modules. A handful of files in src/web/ are additionally aliased at the
// origin root so the PWA pieces (service worker, manifest) can control the
// whole scope.

'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const SRC = path.join(__dirname, 'src');
const PORT = Number(process.env.GAZBOARD_WEB_PORT) || 4173;
const HOST = process.env.GAZBOARD_WEB_HOST || 'localhost';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8'
};

// Files served from web/ at the origin root so a SW based there can control the app.
  const VIRTUALS = {
    '/test/web-driver.html': path.join(__dirname, 'test', 'web-driver.html'),
    '/test/pdfrepro.html': path.join(__dirname, 'test', 'pdfrepro.html')
  };

async function handle(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, 'text/plain', 'Bad request');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'Method not allowed');

  let file = VIRTUALS[urlPath] || path.join(SRC, urlPath);

  // no directory traversal, ever (VIRTUALS are trusted absolute paths)
  const rel = path.relative(SRC, path.resolve(file));
  if (!VIRTUALS[urlPath] && (rel.startsWith('..') || path.isAbsolute(rel))) return send(res, 403, 'text/plain', 'Forbidden');

  try {
    const st = await fsp.stat(file);
    if (st.isDirectory()) file = path.join(file, 'index.html');
  } catch { return send(res, 404, 'text/plain', 'Not found'); }

  try {
    const data = await fsp.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': data.length,
      'Cache-Control': file.endsWith('sw.js') ? 'no-cache' : 'no-cache',
      'Referrer-Policy': 'no-referrer'
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    send(res, 404, 'text/plain', 'Not found');
  }
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type });
  res.end(body);
}

function createServer({ port = 0 } = {}) {
  const server = http.createServer(handle);
  return new Promise((resolve) => {
    server.listen(port, HOST, () => resolve({ server, port: server.address().port, host: HOST }));
  });
}

if (require.main === module) {
  createServer({ port: PORT }).then(({ server, port, host }) => {
    console.log(`GazBoard web build: http://${host}:${port}`);
    console.log('Press Ctrl+C to stop');
    server.on('error', (e) => { console.error('serve failed:', e.message); process.exit(1); });
  });
}

module.exports = { createServer };