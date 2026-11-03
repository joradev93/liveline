# Decisions

Format: what — why — alternatives considered.

## D1. TypeScript 5.9 instead of 7.0

- **What:** pin `typescript@5.9.3`.
- **Why:** 7.0 (the Go-native compiler) is the latest, but `typescript-eslint` supports `<6.1` and
  Next.js tooling still expects the JS compiler API. 5.9 is the newest version every tool supports.
- **Alternatives:** 6.0 (bridge release, little gain for this repo), 7.0 (breaks linting).

## D2. feed-sim is its own process and serves an internal "feed bus" over WebSocket

- **What:** feed-sim runs as a separate service (`ws://:7001/feed`). Consumers (gateway, bet-api)
  get one `feed:snapshot`, then ordered `feed:batch` messages with a `seq` number.
- **Why:** this is the shape of a real sportsbook (feed provider → bus → consumers). The gateway and
  the bet API both need current prices, and both read them from the same source. Phase 2 (Redis
  pub/sub) only replaces the transport.
- **Alternatives:** run the simulator in-process inside the gateway (simpler, but then bet-api must ask
  the gateway for prices, and Phase 2 needs a rewrite); Redis now (spec says Phase 2).

## D3. Feed batches every 10 ms, lifecycle every 100 ms, fractional tick accumulator

- **What:** the loop runs every 10 ms and produces `rate × elapsed` ticks, carrying the fraction.
- **Why:** timers in Node jitter; the accumulator keeps the long-run rate exact
  (measured 198–200 ticks/s at target 200, 1006/s at target 1000). 10 ms keeps feed latency small.
- **Alternatives:** one `setTimeout` per tick (too many timers at 2000/s).

## D4. Synthetic names built from syllables

- **What:** team, player and league names are random syllable combinations ("Torvale Rovers").
- **Why:** the spec forbids real operator data; generated names cannot match a real club by accident
  in any meaningful way, and they look plausible in screenshots.

## D5. Every event has exactly 3 main markets; `sport:{id}` carries only main markets

- **What:** markets 1–3 of each event (winner / total / handicap) have `main: true`. The sport topic
  snapshot carries events with main markets only; `event:{id}` carries all markets.
- **Why:** this is how list views in real sportsbooks work (3 columns per row). It keeps the sport
  snapshot small (one sport ≈ 250 events × 3 markets instead of × 12.5).
- **Alternatives:** full events in sport topics (snapshots ~4× bigger, most data never shown).

## D6. Protocol additions beyond the spec

- **What:** besides market ops `{m, sel}` / `{m, st}` the delta also has event ops `{e, est, sc}`,
  `{add: event}` and `{rm: eventId}`.
- **Why:** the lifecycle (prematch → live → suspended → settled) and the replacement of settled events
  must reach the client. They follow the same coalescing rules.

## D7. Money in integer cents, odds compared as integers

- **What:** `stakeCents`, `potentialReturnCents`, `balanceCents`; odds compared with `Math.round(o*100)`.
- **Why:** no float rounding bugs in balance or odds comparison.
