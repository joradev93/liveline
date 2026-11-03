/**
 * Backpressure check with a real slow client.
 *
 * Opens a raw TCP WebSocket, subscribes to every sport topic, then STOPS READING for
 * --pause seconds so the gateway's socket buffer grows past the high-water mark. Then it
 * reads again, follows the protocol (resubscribe on a version gap) and reports what happened.
 *
 *   node load/slow-client.mjs --pause 15 --after 5
 */
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '7002' },
    pause: { type: 'string', default: '15' },
    after: { type: 'string', default: '5' },
  },
});

const stats = async () => (await fetch(`http://${values.host}:${values.port}/stats`)).json();

function frame(text) {
  const payload = Buffer.from(text);
  const mask = randomBytes(4);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 255]);
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([header, mask, masked]);
}

const socket = net.connect(Number(values.port), values.host);
const versions = new Map();
const seen = { snapshots: 0, deltas: 0, gaps: 0, stale: 0 };
let buffer = Buffer.alloc(0);
let upgraded = false;

socket.on('connect', () => {
  socket.write(
    `GET /ws HTTP/1.1\r\nHost: ${values.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
});

socket.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  if (!upgraded) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) return;
    upgraded = true;
    buffer = buffer.subarray(end + 4);
    socket.write(
      frame(JSON.stringify({ t: 'sub', topics: [1, 2, 3, 4, 5, 6].map((id) => `sport:${id}`) })),
    );
    setTimeout(() => {
      socket.pause(); // stop reading: kernel buffers fill, then the gateway's buffer grows
      console.log(`paused reading for ${values.pause}s`);
      setTimeout(
        () => {
          console.log('resumed reading');
          socket.resume();
          setTimeout(report, Number(values.after) * 1000);
        },
        Number(values.pause) * 1000,
      );
    }, 1000);
  }
  parseFrames();
});

function parseFrames() {
  while (buffer.length >= 2) {
    let len = buffer[1] & 127;
    let offset = 2;
    if (len === 126) {
      if (buffer.length < 4) return;
      len = buffer.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buffer.length < 10) return;
      len = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }
    if (buffer.length < offset + len) return;
    const opcode = buffer[0] & 15;
    const payload = buffer.subarray(offset, offset + len);
    buffer = buffer.subarray(offset + len);
    if (opcode === 1) onMessage(JSON.parse(payload.toString()));
  }
}

function onMessage(msg) {
  if (msg.t === 'snapshot') {
    seen.snapshots++;
    versions.set(msg.topic, msg.v);
  } else if (msg.t === 'delta') {
    const v = versions.get(msg.topic) ?? -1;
    if (msg.v <= v) seen.stale++;
    else if (msg.from > v) {
      seen.gaps++;
      socket.write(frame(JSON.stringify({ t: 'sub', topics: [msg.topic] })));
    } else {
      seen.deltas++;
      versions.set(msg.topic, msg.v);
    }
  }
}

const before = await stats();
async function report() {
  const after = await stats();
  const diff = (k) => after.hub[k] - before.hub[k];
  console.log(
    JSON.stringify(
      {
        client: seen,
        gateway: {
          deltasSkipped: diff('deltasSkipped'),
          gapsSent: diff('gapsSent'),
          resyncs: diff('resyncs'),
          catchUps: diff('catchUps'),
        },
      },
      null,
      2,
    ),
  );
  socket.destroy();
  process.exit(0);
}
