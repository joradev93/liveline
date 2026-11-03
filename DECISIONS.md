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

## D15. k6 runs in Docker; plus a Node load generator

- **What:** `load/k6.sh` runs `grafana/k6:0.54.0` in Docker (no global install). `load/swarm.mjs` is
  a multi-process Node generator.
- **Why:** the spec forbids global installs; Docker is available. k6 in the 10-CPU Docker VM
  saturates at ~10k connections, before the gateway does, so a lighter generator was needed to find
  the gateway's own limit.
- **Alternatives:** k6 binary in the project folder (possible, but Docker was already approved);
  `ws` + autocannon-style tools.

## D16. Latency measured from the oldest change in the delta

- **What:** delta `ts` = feed time of the oldest change coalesced into it.
- **Why:** it is the honest worst case for every change in the delta (includes the coalescing wait).
  Using the newest change would report ~50 ms less on average and hide the cost of coalescing.

## D17. One client store per request, passed by React context

- **What:** `Providers` creates the `LiveStore` in `useState`. The server snapshot is loaded into it
  during render (`loadSnapshot(..., { silent: true })`), so SSR and hydration render the same rows.
- **Why:** a module-level store would be shared between requests on the server.
- **Alternatives:** zustand/redux (more bundle, same idea); passing rows as props (no live updates
  without a second copy of the data).

## D18. Selectors per odds cell, plus a "market shape" selector

- **What:** `usePrice(marketId, k)` returns a number; `useMarketShape` returns an object that only
  changes when the market's selections change (never on a price tick).
- **Why:** a price tick re-renders exactly one `OddsButton`. The row and the market group do not
  re-render (they read only stable data).

## D19. Odds flash = swapping CSS classes on the DOM node

- **What:** in a layout effect, `OddsButton` swaps `flash-up-a` / `flash-up-b` (identical keyframes).
- **Why:** no React state, no extra render. Swapping between two animation names restarts the
  animation without the usual `void el.offsetWidth` trick, which forces a synchronous layout per cell.

## D20. Worker posts batches at most every 16 ms

- **What:** the worker parses JSON, checks versions (`TopicSync`) and posts applied items in one
  `postMessage` per ~16 ms; the store notifies each changed key once per batch.
- **Why:** the main thread gets at most ~60 small messages per second, independent of the number of
  topics, and React renders once per batch.
- **Alternatives:** transferable typed arrays (cheaper structured clone; worth it only for much
  bigger batches — see MORNING.md next steps).

## D21. Window virtualizer with `initialRect`

- **What:** `useWindowVirtualizer` with `initialRect: 1280×1000`.
- **Why:** the server has no viewport. With a fixed guess, the server renders the first rows (good
  LCP) and the first client render produces the same rows, so hydration matches.

## D22. Extensionless relative imports in `@liveline/protocol`

- **What:** `export * from './domain'` instead of `'./domain.js'`.
- **Why:** Turbopack (Next 16 default) does not map `.js` to `.ts` inside a transpiled workspace
  package. All consumers use bundler resolution (tsx, tsup, vitest, Next), so this is safe.

## D23. The feed bus client lives in feed-sim (`@liveline/feed-sim/client`)

- **Why:** gateway and bet-api both consume the bus. The owner of the bus ships its client. A subpath
  export keeps `ws` (server-only) out of the consumers' bundles.

## D24. Bet validation rules

- **What:** `validateBet` (pure) checks, in order: same-event legs in a multiple → market exists and
  belongs to the event → event/market not settled → not suspended → selection exists → price policy.
  `higher` is checked **per leg**: a multiple is refused if any leg got shorter, even if the combined
  price went up.
- **Why:** per-leg is what users expect ("I accept better prices") and what most operators do.
  Legs are always placed at the **current** price (with its market version), never the requested one.
- **Alternatives:** compare only combined odds for multiples (a user could get a shorter leg hidden by
  a longer one).

## D25. Idempotency

- **What:** `Idempotency-Key` is required, scoped per user. The request hash is SHA-256 of the
  zod-parsed body (fixed key order). Same key + same body → stored response is replayed with
  `Idempotent-Replayed: true`. Same key + other body → 422. Business outcomes (201, 409, 422) are
  stored; 400 (invalid input) and 503 (feed not ready) are not, because they do not depend on state.
- **Why:** the client retries network failures with the same key (`placeBet` in the web app), so a lost
  response never leads to a second bet.
- **Concurrency:** lookup, validation, debit, insert and the idempotency record run synchronously in one
  SQLite transaction. Node runs one handler body at a time, so two requests with the same key cannot
  interleave. Test: 20 parallel requests with one key → exactly 1 bet, 1 debit.

## D26. Demo identity = `X-User-Id` header

- **What:** a random id per browser (localStorage), each with a mock balance of €1000 (`POST /me/reset`).
- **Why:** no accounts in scope. Real auth would replace the header with a verified session.

## D27. Betslip legs keep their prices live through `event:{id}` subscriptions

- **Why:** a leg stays on the slip when the user switches sport. The slip subscribes to the event topics
  of its legs (ref-counted, shared with the event panel), so prices and suspensions stay current.

## D28. Initial JS target (< 120 KB) not reached; lazy-loading side panels reverted

- **Measured:** Next.js 16 runtime + React 19 DOM + Turbopack runtime = 128.9 KB gzip on their own.
  App code adds ~26 KB. Total initial JS 154.7 KB gzip (133.0 KB with brotli).
- **Tried:** `next/dynamic` for the betslip, metrics panel and event panel. Result: initial JS
  −2.5 KB, total JS +3.9 KB (more chunks), plus a placeholder flash. Reverted.
- **What would reach < 120 KB:** a different framework for this page (e.g. Preact/Solid, or React
  without the Next.js App Router runtime). The spec asks for Next.js App Router + RSC, so the number is
  reported as missed instead of changing the stack.

## D29. CSS inlined, lead paragraph as the LCP element

- **What:** `experimental.inlineCss` (6 KB CSS) and a short server-rendered paragraph under the sport
  heading.
- **Why:** Lighthouse showed a render-blocking CSS request and, on desktop, an LCP candidate in the
  side panel that was sometimes painted late. Both fixed; numbers in METRICS.md.

## D30. Metrics panel measures in the browser, not on the server

- **What:** msgs/s, KB/s, ops/s and tick latency come from the worker; FPS, slow frames, long tasks and
  odds-cell renders from the main thread; INP/LCP from `web-vitals` (loaded with `import()`).
- **Why:** these are what the visitor experiences on their own device; server numbers live in
  METRICS.md.

## D31. Load slider goes through a Next.js route handler

- **What:** `POST /api/load` → feed-sim `POST /rate`. `LOAD_CONTROL=off` disables it.
- **Why:** feed-sim stays private (no CORS, no public port). The slider is shared by all viewers,
  which the UI says.

## D32. Feed bus client: reconnect from `error` or `close`, once per socket

- **What:** `FeedClient` schedules a reconnect from whichever of `error` / `close` fires first.
- **Why:** Node 22's built-in WebSocket fires only `error` when the handshake fails (no `close`, the
  state stays CONNECTING), and calling `close()` from `onerror` re-entered `onerror` until the stack
  overflowed. Found when `pnpm start` started the gateway before feed-sim. Test:
  `apps/feed-sim/src/client.test.ts`.

## D33. Docker image: tsup bundle + external dependencies only (`scripts/pack-app.mjs`)

- **What:** the image copies `dist/` and installs only the app's non-workspace dependencies
  (`npm install --omit=dev`, exact versions from the app's package.json).
- **Why:** `pnpm deploy` in pnpm 10 needs `inject-workspace-packages=true`, which would make every
  change in `packages/protocol` need a reinstall during development. The bundle already contains the
  workspace code.
- **Tested:** the packing step and the packed apps (start, connect with a bus token). The Docker build
  itself was not run (no base image pulled).

## D34. Optional tokens for feed-sim in public deployments

- **What:** `FEED_CONTROL_TOKEN` (Bearer for `POST /rate`) and `FEED_BUS_TOKEN` (`?token=` for the
  feed bus). Off when unset. Tokens are removed from log lines.
- **Why:** on Vercel the load slider's route handler must reach feed-sim over the internet.

## D35. Demo GIF without ffmpeg

- **What:** `e2e/record-demo.mjs` records frames with Chrome's screencast (CDP);
  `e2e/make-gif.mjs` builds the GIF in JS (jpeg-js + gifenc) with frame differencing (unchanged pixels
  are transparent): 4.1 MB for 24 s at 960×600, 8 fps.
- **Why:** Playwright video needs its own ffmpeg download outside the project, and the system ffmpeg
  on this machine is broken (missing `libx265`). See BLOCKERS.md B3.
