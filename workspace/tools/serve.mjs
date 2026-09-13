// 零依赖静态服务器：npm run dev  →  http://localhost:8080
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const PORT = process.env.PORT || 8080;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, urlPath);
  if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback
      file = path.join(ROOT, 'index.html');
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, () => console.log(`笔顺字帖: http://localhost:${PORT}`));
