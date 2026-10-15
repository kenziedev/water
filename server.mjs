import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const files = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['style.css', 'text/css; charset=utf-8'],
  ['water.js', 'text/javascript; charset=utf-8'],
  ['assets/ocean.mp4', 'video/mp4'],
  ['assets/ocean-poster.jpg', 'image/jpeg'],
]);

createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/water') {
    response.writeHead(302, { Location: '/water/' }).end();
    return;
  }
  const file = path === '/' || path === '/water/' ? 'index.html' : path.replace(/^\/(?:water\/)?/, '');
  if (!files.has(file)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const url = new URL(file, import.meta.url);
    const { size } = await stat(url);
    const headers = { 'Content-Type': files.get(file), 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' };
    let start = 0, end = size - 1, status = 200;
    if (request.headers.range && request.method === 'GET') {
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      if (range && (range[1] || range[2])) {
        start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
      } else start = size;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
        return;
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = end - start + 1;
    response.writeHead(status, headers);
    if (request.method === 'HEAD') response.end();
    else {
      const stream = createReadStream(url, { start, end });
      stream.on('error', () => response.destroy());
      response.on('close', () => stream.destroy());
      stream.pipe(response);
    }
  } catch {
    response.writeHead(500).end('Unable to load page');
  }
}).listen(4173, '127.0.0.1', () => console.log('Local: http://127.0.0.1:4173/water/'));
