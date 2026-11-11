// Minimal local server for the benchmark page (Node built-ins only).
// Served over http:// because the content script does not match file:// URLs.
//
//   node bench/serve.mjs            -> http://127.0.0.1:4173/
//   BENCH_PORT=5000 node bench/serve.mjs
//
// Routes:
//   /                       index with preset links
//   /page?n=1000            page with ~n generated elements (rounded up to a multiple of 20)
//   /page?n=1000&delay=500  sends <head> + header immediately, the rest after `delay` ms

import { createServer } from 'node:http';
import { PRESET_SIZES, renderPage } from './page.mjs';

const HOST = '127.0.0.1';
const PORT = Number(process.env.BENCH_PORT ?? 4173);
const MAX_DELAY_MS = 10000;

const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
};

function indexHtml() {
  const links = PRESET_SIZES.map(
    (n) => `<li><a href="/page?n=${n}">${n} elements</a> · <a href="/page?n=${n}&delay=1000">delayed body (1s)</a></li>`,
  ).join('');
  return `<!doctype html><meta charset="utf-8"><title>Nocturne bench</title><h1>Nocturne bench</h1><ul>${links}</ul>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);

  if (url.pathname === '/') {
    res.writeHead(200, HEADERS).end(indexHtml());
    return;
  }

  if (url.pathname === '/page') {
    const { head, body } = renderPage(url.searchParams.get('n') ?? PRESET_SIZES[0]);
    const delay = Math.min(Math.max(Number(url.searchParams.get('delay')) || 0, 0), MAX_DELAY_MS);

    res.writeHead(200, HEADERS);
    res.write(head);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    res.end(body);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Nocturne bench: http://${HOST}:${PORT}/`);
});
