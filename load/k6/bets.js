/**
 * Bet placement load: constant arrival rate of POST /bets, each with a new Idempotency-Key.
 * Legs are picked from open main markets of prematch events (from a gateway snapshot), with
 * acceptChanges=any, so most bets are accepted; rejections (suspended, closed) are counted.
 *
 * Env: BET_URL, GW_HTTP, RATE (req/s), DURATION
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BET_URL = __ENV.BET_URL || 'http://host.docker.internal:7003';
const GW_HTTP = __ENV.GW_HTTP || 'http://host.docker.internal:7002';
const accepted = new Counter('bets_accepted');
const rejected = new Counter('bets_rejected');

export const options = {
  scenarios: {
    bets: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 200),
      timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: { http_req_failed: ['rate<0.01'] },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  const legs = [];
  for (const sport of [1, 2, 3]) {
    const snap = http.get(`${GW_HTTP}/snapshot/sport:${sport}`).json();
    for (const e of snap.events) {
      if (e.status !== 'prematch') continue;
      const m = e.markets[0];
      if (m.status === 'open')
        legs.push({ eventId: e.id, marketId: m.id, sel: m.sel[0].k, odds: m.sel[0].p });
    }
  }
  return { legs };
}

export default function (data) {
  const leg = data.legs[Math.floor(Math.random() * data.legs.length)];
  const res = http.post(
    `${BET_URL}/bets`,
    JSON.stringify({ type: 'single', stakeCents: 1, acceptChanges: 'any', legs: [leg] }),
    {
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `k6-${__VU}-${__ITER}-${Date.now()}`,
        'x-user-id': `k6-user-${__VU}`,
      },
    },
  );
  if (res.status === 201) accepted.add(1);
  else rejected.add(1);
  check(res, { 'answered (201 or 409/422)': (r) => [201, 409, 422].includes(r.status) });
}
