/**
 * HTTP proxy that adds a fixed delay before forwarding, to simulate network distance between
 * the Next.js server and the gateway (on one machine both answer in a few ms).
 *
 *   node e2e/delay-proxy.mjs --port 7012 --target http://127.0.0.1:7002 --delay 300
 *   GATEWAY_HTTP=http://127.0.0.1:7012 pnpm --filter @liveline/web start
 */
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '7012' },
    target: { type: 'string', default: 'http://127.0.0.1:7002' },
    delay: { type: 'string', default: '300' },
  },
});
const delay = Number(values.delay);
let forwarded = 0;

createServer((req, res) => {
  // How many requests reached the gateway through this proxy (e.g. to see server-side caching).
  if (req.url === '/__stats') return void res.end(JSON.stringify({ forwarded }));
  forwarded++;
  setTimeout(async () => {
    try {
      const upstream = await fetch(new URL(req.url ?? '/', values.target));
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      res.writeHead(502).end();
    }
  }, delay);
}).listen(Number(values.port), () =>
  console.log(`delay proxy :${values.port} -> ${values.target} (+${delay} ms)`),
);
