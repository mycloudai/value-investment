import http from 'http';
import fs from 'fs';
import path from 'path';

const SITE_DIR = path.resolve('site');
const PORT = parseInt(process.env.PORT || '8788', 10);
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown',
  '.woff2': 'font/woff2',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const server = http.createServer((req, res) => {
  // Handle /api/chat stub — mimics Cloudflare Pages Function for CI testing
  if (req.url === '/api/chat' || req.url.startsWith('/api/chat?')) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (_) {}
        const headers = Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS);
        if (parsed.action === 'list_models') {
          res.writeHead(200, headers);
          res.end(JSON.stringify({
            error: 'API 代理仅在 Cloudflare Pages Functions 环境中可用',
            details: 'serve.mjs 静态服务器不支持 Pages Functions，请使用 ./start-local.sh 启动'
          }));
        } else {
          // For chat requests, return SSE error
          res.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, CORS_HEADERS));
          res.end('event: error\ndata: {"message":"serve.mjs 不支持 Pages Functions，请使用 ./start-local.sh 启动"}\n\n');
        }
      });
      return;
    }
  }

  let filePath = path.join(SITE_DIR, req.url.split('?')[0]);
  
  // If it's a directory, try index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }
  
  // If file exists, serve it
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mimeType });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  
  // SPA fallback: serve index.html for non-file routes
  const indexPath = path.join(SITE_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(indexPath).pipe(res);
    return;
  }
  
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log('SPA server running at http://localhost:' + PORT + '/');
});
