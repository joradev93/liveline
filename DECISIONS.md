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

## D8. Coalescing per topic, not per client

- **What:** the gateway keeps one pending map per topic (latest value per market / event). Every flush
  (100 ms) each changed topic becomes one delta, serialized once and sent as the same bytes to all
  subscribers. Per client the gateway only keeps a version cursor per topic.
- **Why:** all subscribers of a topic need exactly the same data, so a per-client buffer would repeat
  the same merge and `JSON.stringify` N times. Per-topic coalescing gives the same result as a
  per-client "latest value per market" buffer at a fraction of the CPU. Measured flush time is in
  METRICS.md.
- **Alternatives:** per-client buffers (spec wording; O(clients × changes) work per flush);
  uWS built-in `publish()` (fast C++ fan-out, but no per-client backpressure decision and no
  per-client version cursor).

## D9. One gateway-wide version counter

- **What:** topic versions come from a single counter that increases on every recorded op.
- **Why:** versions stay monotonic per topic even when a topic is dropped (last unsubscribe) and created
  again later. Version numbers can jump; clients only compare `from` with their own version.

## D10. Gap rule: `from > clientVersion`, not `from !== clientVersion`

- **What:** a client resyncs only when `delta.from > clientVersion`; it ignores deltas with
  `v <= clientVersion`.
- **Why:** ops carry absolute values (latest price, latest status), so a delta from `f` to `v` can be
  applied to any state between `f` and `v`. This lets a client that got a snapshot in the middle of a
  flush window apply the next delta without a useless resync. It also allows caching one snapshot per
  topic per flush window (D11).

## D11. Snapshot cache per topic per flush window

- **What:** the serialized snapshot of a topic is cached until the next flush.
- **Why:** when many clients subscribe at once (page loads, load tests, reconnect storms) the gateway
  serializes a sport snapshot (~200 KB) once per 100 ms instead of once per client. Correct because of
  D10: a cached snapshot at version c satisfies `flushedV <= c`.

## D12. Backpressure: skip deltas, client resyncs; plus server catch-up for quiet topics

- **What:** if a socket has more than `GW_HIGH_WATER` (512 KB) buffered, the flush skips it. The next
  delta it gets has a gap and the client resubscribes (spec flow). If no newer delta arrives on that
  topic (a quiet event topic), the gateway pushes a fresh snapshot once the socket has drained.
- **Why:** without the catch-up a skipped client could show a stale price for as long as the topic
  stays quiet. A unit test reproduced exactly this before the fix.
- **Hard limit:** uWS `maxBackpressure` (8 MB) closes sockets that never drain.

## D13. Load uWebSockets.js through createRequire

- See BLOCKERS.md B1. The ESM wrapper of v20.71.0 is broken.

## D14. Apps are bundled with tsup, workspace packages included

- **What:** `noExternal: [/^@liveline\//, 'zod']`. Native modules (uWS, better-sqlite3) stay external.
- **Why:** workspace packages export TypeScript source; the production bundle must not import `.ts`.
