// Tiny static server for the film pages (ES modules + fetch need http://, not file://).
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.txt': 'text/plain; charset=utf-8',
};
export function serve(root, port = 0) {
  root = path.resolve(root);
  return new Promise((res, rej) => {
    const srv = http.createServer((req, rsp) => {
      let p;
      try { p = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname)); } catch { rsp.writeHead(400); return rsp.end(); }
      if (p !== root && !p.startsWith(root + path.sep)) { rsp.writeHead(403); return rsp.end('forbidden'); }
      if (req.url === '/favicon.ico') { rsp.writeHead(204); return rsp.end(); }
      let f = p;
      try { if (statSync(f).isDirectory()) f = path.join(f, 'index.html'); statSync(f); }
      catch { console.error(`[serve] 404 ${req.url}`); rsp.writeHead(404, { 'Cache-Control': 'no-store' }); return rsp.end('not found'); }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': statSync(f).size });
      if (req.method === 'HEAD') return rsp.end();
      createReadStream(f).on('error', () => rsp.destroy()).pipe(rsp);
    });
    srv.on('error', rej);
    srv.listen(port, '127.0.0.1', () => res({ port: srv.address().port, close: () => { srv.closeAllConnections?.(); srv.close(); } }));
  });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(process.argv[2] || '.'), port = +(process.argv[3] || 8017);
  serve(root, port).then(s => console.log(`serving ${root} at http://127.0.0.1:${s.port}/`));
}
