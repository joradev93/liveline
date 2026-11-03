/**
 * k6 WebSocket load test for the gateway.
 *
 * Each VU holds one connection subscribed to one sport topic (VUs spread over the 6 sports)
 * and records tick->client latency from the delta `ts` (feed time of the oldest change in
 * the delta). k6 runs in Docker, so its clock offset to the gateway host is measured in
 * setup() with /time and subtracted.
 *
 * Env: GW_URL, GW_HTTP, VUS (target), RAMP (e.g. 30s), HOLD (e.g. 60s)
 */
import http from 'k6/http';
import ws from 'k6/ws';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const GW_URL = __ENV.GW_URL || 'ws://host.docker.internal:7002/ws';
const GW_HTTP = __ENV.GW_HTTP || 'http://host.docker.internal:7002';
const VUS = Number(__ENV.VUS || 500);
const RAMP = __ENV.RAMP || '30s';
const HOLD = __ENV.HOLD || '60s';

const latency = new Trend('tick_latency', true);
const deltas = new Counter('deltas');
const snapshots = new Counter('snapshots');
const gaps = new Counter('version_gaps');
const errors = new Counter('server_errors');

export const options = {
  scenarios: {
    clients: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP, target: VUS },
        { duration: HOLD, target: VUS },
      ],
      gracefulRampDown: '0s',
      gracefulStop: '0s',
    },
  },
  thresholds: {
    tick_latency: ['p(99)<150'],
    version_gaps: ['count<1'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  // Clock offset (server - local), taken from the sample with the smallest round trip.
  let best = { rtt: Infinity, offset: 0 };
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const res = http.get(`${GW_HTTP}/time`);
    const t1 = Date.now();
    const rtt = t1 - t0;
    if (res.status === 200 && rtt < best.rtt)
      best = { rtt, offset: res.json('now') - (t0 + t1) / 2 };
  }
  console.log(`clock offset ${best.offset.toFixed(1)} ms (rtt ${best.rtt} ms)`);
  return { offset: best.offset };
}

// Cheap header parsing: JSON.stringify keeps key order, so no full JSON.parse per message.
const HEAD = /^\{"t":"(\w+)","topic":"([\w:]+)",(?:"from":(\d+),)?"v":(\d+)/;
const TS = /"ts":(\d+)\}$/;

export default function (data) {
  const topic = `sport:${1 + (__VU % 6)}`;
  const res = ws.connect(GW_URL, null, (socket) => {
    let version = -1;
    socket.on('open', () => socket.send(JSON.stringify({ t: 'sub', topics: [topic] })));
    socket.on('message', (msg) => {
      const head = HEAD.exec(msg.slice(0, 120));
      if (!head) {
        if (msg.indexOf('"t":"error"') >= 0) errors.add(1);
        return;
      }
      const v = Number(head[4]);
      if (head[1] === 'snapshot') {
        snapshots.add(1);
        version = v;
        return;
      }
      if (v <= version) return;
      if (Number(head[3]) > version) {
        gaps.add(1);
        socket.send(JSON.stringify({ t: 'sub', topics: [topic] }));
        return;
      }
      version = v;
      deltas.add(1);
      const ts = TS.exec(msg.slice(-40));
      if (ts) latency.add(Date.now() + data.offset - Number(ts[1]));
    });
    socket.setTimeout(() => socket.close(), 30 * 60 * 1000);
  });
  check(res, { 'upgraded (101)': (r) => r && r.status === 101 });
}
