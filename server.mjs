import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = new Map([['index.html','text/html; charset=utf-8'],['style.css','text/css; charset=utf-8'],['water.js','text/javascript; charset=utf-8'],['ocean.js','text/javascript; charset=utf-8'],['assets/seabed.png','image/png']]);
createServer(async (request,response) => {
  const path = new URL(request.url,'http://localhost').pathname;
  if(path === '/water') { response.writeHead(302,{Location:'/water/'}); response.end(); return; }
  const file = path === '/' || path === '/water/' ? 'index.html' : path.replace(/^\/(?:water\/)?/,'');
  if(!files.has(file)) { response.writeHead(404); response.end('Not found'); return; }
  try { const content=await readFile(new URL(file,import.meta.url));response.writeHead(200,{'Content-Type':files.get(file),'Cache-Control':'no-cache'});response.end(content); } catch { response.writeHead(500);response.end('Unable to load page'); }
}).listen(4173,'127.0.0.1',() => console.log('Local: http://127.0.0.1:4173/water/'));
