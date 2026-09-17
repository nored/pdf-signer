// Tiny static file server. Rooted at the repo root so /web/index.html works.
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.pdf':  'application/pdf',
};

export async function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(req.url.split('?')[0]);
      if (path === '/' || path === '') path = '/web/index.html';
      const abs = join(ROOT, path);
      if (!abs.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      const bytes = await readFile(abs);
      res.writeHead(200, {
        'Content-Type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(bytes);
    } catch (e) {
      res.writeHead(404); res.end('not found: ' + req.url);
    }
  });
  await new Promise(res => server.listen(port, '127.0.0.1', res));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
