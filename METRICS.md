# Metrics

Every number here was measured on the machine listed, with the command shown.
Nothing is estimated. If a target has no row, it was not measured.

## Machine

- Apple M5 Pro, 15 cores, 24 GB RAM, macOS 26.5.1, Node 22.22.3
- Docker Desktop VM for k6: 10 CPUs, 8 GB
- Everything (feed-sim, gateway, load generator) runs on this one laptop, so the load generator
  competes with the gateway for CPU. Numbers from a real deployment will differ.

## Definitions

- **tick→client latency** = client receive time − `ts` of the delta, where `ts` is the feed timestamp
  of the **oldest** change in that delta. It includes the 100 ms coalescing window on purpose, so it
  is the worst case for any change inside the delta. For k6 (Docker clock) the clock offset to the
  host is measured in `setup()` via `GET /time` (measured offset: 0.0 ms, RTT 0 ms) and subtracted.
- Each simulated client subscribes to one `sport:{id}` topic (≈ 260 events, 3 main markets each).
- Feed: `FEED_SEED=42`, 1500 events, 18 533 markets.

## Gateway: k6 (Docker), 500 ticks/s

Commands (feed-sim running with `FEED_LOG=quiet FEED_RATE=500 node apps/feed-sim/dist/index.js`):

```bash
pnpm build
VUS=500   RAMP=20s HOLD=40s sh load/step.sh
VUS=2000  RAMP=40s HOLD=60s sh load/step.sh
VUS=5000  RAMP=60s HOLD=60s sh load/step.sh
VUS=10000 RAMP=90s HOLD=60s sh load/step.sh
node load/summarize.mjs
```

Raw files: `load/results/k6-*.json`, `load/results/gw-cpu-*.txt`, `load/results/gw-stats-*.json`.
Gateway CPU is `ps %cpu` of the gateway process (100% = one core), sampled every 5 s.

| clients | tick→client p50 | p95    | p99    | max      | msgs/s received | version gaps | failed upgrades | gateway CPU avg / max | gateway RSS max |
| ------- | --------------- | ------ | ------ | -------- | --------------- | ------------ | --------------- | --------------------- | --------------- |
| 500     | 80 ms           | 104 ms | 109 ms | 115 ms   | 3862            | 0            | 1               | 6% / 14%              | 150 MB          |
| 2000    | 84 ms           | 108 ms | 113 ms | 129 ms   | 15051           | 0            | 0               | 12% / 19%             | 173 MB          |
| 5000    | 92 ms           | 123 ms | 134 ms | 377 ms   | 34520           | 0            | 0               | 22% / 30%             | 169 MB          |
| 10000   | 114 ms          | 319 ms | 550 ms | 46065 ms | 65073           | 0            | 1               | 38% / 54%             | 159 MB          |

- At 10 000 the p99 target (150 ms) fails, but **k6 is the bottleneck**: the k6 container used
  682% CPU and 3.1 GB (`docker stats`, file `load/results/k6-docker-10000.txt`) while the gateway
  used 38% avg of one core. k6 also received fewer messages than the gateway sent (65k/s vs
  ~100k/s expected), so k6 fell behind. → k6 verifies **5000** clients within target.
- "failed upgrades": in the 500 run one connection attempt timed out after 30 s; in the 10 000 run
  one as well. Not investigated further (Docker Desktop networking is the likely cause; the Node
  generator below had 0 failures at 15 000).

## Gateway: Node swarm generator (host), 500 ticks/s

k6 saturates before the gateway does, so `load/swarm.mjs` (several Node processes, regex header
parsing, latency histogram only during the hold phase) was used to push further.

```bash
node load/swarm.mjs --clients 10000 --procs 6 --ramp 40 --hold 60
node load/swarm.mjs --clients 15000 --procs 8 --ramp 60 --hold 60
```

| clients | p50    | p95    | p99    | max    | deltas/s received | gaps | failed | gateway CPU avg / max | max flush |
| ------- | ------ | ------ | ------ | ------ | ----------------- | ---- | ------ | --------------------- | --------- |
| 10 002  | 94 ms  | 125 ms | 133 ms | 157 ms | 91 629            | 0    | 0      | 32% / 36%             | 66.7 ms   |
| 15 000  | 101 ms | 139 ms | 149 ms | 167 ms | 140 542           | 0    | 0      | 48% / 53%             | 82 ms     |

- **Max clients per gateway instance: not reached.** 15 000 is the most this laptop can open:
  macOS has one pool of ~16 000 ephemeral ports for outgoing connections (a 20 000 run failed with
  `EADDRNOTAVAIL` on the client side). Raising it needs a system setting change, which was out of
  scope for this run.
- What limits the gateway next is **latency, not CPU**: at 15 000 clients p99 is 149 ms with the
  event loop ~50% busy. A flush sends one delta to every subscriber in a JS loop; the last sockets
  in the loop get the data later (max flush 82 ms). See MORNING.md "next steps" for the fix
  (uWS native `publish()` for clients that are in sync).

## Gateway at max feed rate (2000 ticks/s), k6, 2000 clients

```bash
curl -XPOST localhost:7001/rate -d '{"rate":2000}'
VUS=2000 RAMP=40s HOLD=60s sh load/step.sh   # files renamed to *-2000-rate2000.*
```

| clients | p50    | p95    | p99    | max    | msgs/s received | gaps | gateway CPU avg / max |
| ------- | ------ | ------ | ------ | ------ | --------------- | ---- | --------------------- |
| 2000    | 101 ms | 114 ms | 117 ms | 140 ms | 15 855          | 0    | 13% / 21%             |

Messages per second do not grow with the tick rate: coalescing caps it at one delta per topic per
100 ms. Only the delta size grows.

## Backpressure with a real slow client

`load/slow-client.mjs` opens a raw TCP WebSocket, subscribes to all 6 sport topics and stops reading.

```bash
curl -XPOST localhost:7001/rate -d '{"rate":2000}'
node load/slow-client.mjs --pause 90 --after 5
```

| what                                             | value                     |
| ------------------------------------------------ | ------------------------- |
| deltas skipped by the gateway (buffer > 512 KB)  | 708                       |
| version gaps seen by the client after it resumed | 6 (one per topic)         |
| client resyncs (re-subscribe → snapshot)         | 6                         |
| snapshots received in total                      | 12 (6 initial + 6 resync) |

With pauses of 15 s and 40 s nothing was skipped: macOS lets the kernel hold up to 8 MB per
connection (`net.inet.tcp.autosndbufmax` + `autorcvbufmax` = 4 MB each) before uWS starts buffering.

## Web: initial JavaScript

Production build (`next build`, Turbopack), served by `next start` (gzip). Measured in Chrome via
Resource Timing `encodedBodySize` (bytes on the wire). "Initial" = scripts referenced by the raw server
HTML. Raw output: `e2e/results/bundle.txt`.

```bash
pnpm --filter @liveline/web build && pnpm --filter @liveline/web start
node e2e/measure-bundle.mjs
```

| what                                                      | Day 4    | Day 6                     | Day 8 (final)               |
| --------------------------------------------------------- | -------- | ------------------------- | --------------------------- |
| initial JS, gzip (on the wire)                            | 150.4 KB | 154.7 KB (8 files)        | **145.5 KB** (7 files)      |
| initial JS, same files with brotli q11 (computed locally) | —        | 133.0 KB                  | 124.8 KB                    |
| — Next.js runtime + React DOM + Turbopack runtime (gzip)  | 128.6 KB | 128.9 KB                  | 128.8 KB                    |
| — app code (gzip)                                         | 21.8 KB  | 25.8 KB (+ metrics panel) | 16.8 KB (own virtualizer)   |
| lazy JS after hydration (web-vitals)                      | —        | 2.5 KB                    | 2.5 KB                      |
| HTML document, gzip                                       | 28.1 KB  | 33.2 KB                   | 15.7 KB (110.0 KB unzipped) |

**Target < 120 KB: missed.** The framework alone (Next.js 16 App Router + React 19 DOM) is
128.8 KB gzip, above the target before any app code. See DECISIONS D28 for what was tried, and
D37 for the Day 8 change. Day 8 raw output: `e2e/results/opt-after/bundle.txt`.

After the deploy (2026-11-05) the metrics panel got a help list with one text per metric:
initial JS **146.2 KB** gzip (+0.7 KB, 7 files), 125.4 KB brotli, HTML 16.0 KB gzip (112.9 KB
unzipped). Same command, web on port 3002: `node e2e/measure-bundle.mjs http://localhost:3002/`.

Later on 2026-11-05, after the mobile bottom bar (shared metrics provider, compact strip) and the
count badges on the sport tabs: initial JS **146.8 KB** gzip (+0.6 KB, 7 files), 126.0 KB brotli,
HTML 17.5 KB gzip (119.8 KB unzipped). Command:
`node e2e/measure-bundle.mjs 'http://localhost:3002/?sport=1'`. Raw: `e2e/results/2026-11-05/bundle.txt`.

## Web: Lighthouse (Lighthouse CI 0.16, Chrome, 3 runs, median)

```bash
cd e2e && CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npx lhci collect --config=lighthouserc.json          # mobile (default: simulated slow 4G, 4x CPU)
# desktop: --config=lighthouserc.desktop.json
node lh-summary.mjs results/lighthouse-mobile
```

| preset  | performance | accessibility | best practices | FCP    | LCP        | TBT  | CLS | LCP element                |
| ------- | ----------- | ------------- | -------------- | ------ | ---------- | ---- | --- | -------------------------- |
| mobile  | 100         | 100           | 100            | 790 ms | **790 ms** | 0 ms | 0   | team name in the first row |
| desktop | 100         | 100           | 100            | 209 ms | **209 ms** | 0 ms | 0   | lead paragraph             |

LCP target (< 1.5 s): met in both presets. Raw: `e2e/results/lighthouse-*/`.

Measured again on 2026-11-05 after the mobile bottom bar and the count badges (same commands,
`--url=http://localhost:3002/?sport=1`; raw: `e2e/results/2026-11-05/lighthouse-*/`):

| preset                                                                      | performance | accessibility | best practices | FCP    | LCP        | TBT  | CLS | LCP element                         |
| --------------------------------------------------------------------------- | ----------- | ------------- | -------------- | ------ | ---------- | ---- | --- | ----------------------------------- |
| mobile                                                                      | 100         | 100           | 100            | 791 ms | **791 ms** | 2 ms | 0   | team name in the first row (2 of 3) |
| desktop                                                                     | 100         | 100           | 100            | 213 ms | **213 ms** | 0 ms | 0   | lead paragraph                      |
| Server, gateway and feed run on the same machine (no real network latency). |

## Web: runtime under feed load (FPS, INP, long tasks)

`e2e/measure-runtime.mjs` drives Chrome (headless, 1280×800): 10 s idle with live updates, 10 s of
continuous wheel scrolling, then 30+ interactions (toggle odds in the betslip, open/close the event
panel) and 4 sport switches. Frames from `requestAnimationFrame`, long tasks from
`PerformanceObserver('longtask')`, interaction latency from Event Timing (`interactionId`).
INP = worst interaction (fewer than 50 interactions). CPU slowdown via CDP
`Emulation.setCPUThrottlingRate` (checked: a fixed JS loop ran 3.65× slower at rate 4).

```bash
node e2e/measure-runtime.mjs --rate 500 --cpu 1
node e2e/measure-runtime.mjs --rate 500 --cpu 4
node e2e/measure-runtime.mjs --rate 2000 --cpu 4
```

| feed rate | CPU slowdown | FPS idle | frame p95 idle | FPS scrolling | frame p95 / max scrolling | long tasks | INP   | worst sport switch | ops/s applied | odds cells rendered/s | tick→client p50 / p99 |
| --------- | ------------ | -------- | -------------- | ------------- | ------------------------- | ---------- | ----- | ------------------ | ------------- | --------------------- | --------------------- |
| 500/s     | 1×           | 60       | 16.7 ms        | 60.1          | 16.7 / 33.3 ms            | 0          | 32 ms | 32 ms              | 17            | 10                    | 75 / 101 ms           |
| 500/s     | 4×           | 60.1     | 16.7 ms        | 60.3          | 16.7 / 16.8 ms            | 0          | 32 ms | 16 ms              | 26            | 2                     | 73 / 103 ms           |
| 2000/s    | 4×           | 60       | 16.8 ms        | 60.3          | 16.7 / 16.8 ms            | 0          | 32 ms | 32 ms              | 80            | 14                    | 92 / 101 ms           |

Measured again on 2026-11-05 after the mobile bottom bar and the count badges (same commands with
`--url http://localhost:3002/?sport=1`; raw: `e2e/results/2026-11-05/runtime-*.json`):

| feed rate | CPU slowdown | FPS idle | frame p95 idle | FPS scrolling | frame p95 / max scrolling | long tasks | INP   | worst sport switch | ops/s applied | odds cells rendered/s | tick→client p50 / p99 |
| --------- | ------------ | -------- | -------------- | ------------- | ------------------------- | ---------- | ----- | ------------------ | ------------- | --------------------- | --------------------- |
| 500/s     | 1×           | 60       | 16.7 ms        | 60.2          | 16.7 / 33.3 ms            | 0          | 40 ms | 40 ms              | 18            | 5                     | 82 / 100 ms           |
| 500/s     | 4×           | 60       | 16.7 ms        | 60            | 16.8 / 33.4 ms            | 0          | 32 ms | 32 ms              | 23            | 10                    | 72 / 100 ms           |
| 2000/s    | 4×           | 60       | 16.8 ms        | 59.9          | 16.7 / 33.4 ms            | 0          | 32 ms | 32 ms              | 85            | 20                    | 94 / 101 ms           |

- INP target (< 100 ms at 500 ticks/s): met (32 ms; 40 ms in the 2026-11-05 run at 1× CPU, where
  the worst interaction was the first sport switch). Event Timing rounds durations to 8 ms.
- "ops/s applied" and "odds cells rendered/s" come from the app's own metrics panel during the idle
  phase: the client receives one sport topic (main markets only), and React re-renders only odds
  cells that are mounted (visible + overscan) and whose price changed.
- Why it is this light: coalescing (≤ 10 messages/s per topic) + topic scoping (one sport, main
  markets) + per-cell selectors. The 2000 ticks/s feed produces ~80 applied ops/s for the
  Football topic.
- Raw: `e2e/results/runtime-*.json`.

## Fixes made because of measurements

| found by                        | problem                                                                          | fix                                                                     | result                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| randomized replica test (Day 2) | a client skipped under backpressure stays stale on a quiet topic                 | catch-up snapshot when it drains                                        | test passes; D12                                                            |
| slow-client run (Day 3)         | backpressure never triggered with 15 s / 40 s pauses                             | none needed: macOS kernel buffers hold 8 MB first; test with 90 s pause | 708 skipped, 6 resyncs                                                      |
| code review (Day 4)             | market group re-rendered on every price tick                                     | `useMarketShape` (stable object)                                        | verified with the render counter: 2–18 odds cells rendered/s at 26–80 ops/s |
| Lighthouse                      | LIVE badge contrast 3.33:1, SUSP badge 3.13:1                                    | darker backgrounds                                                      | accessibility 95 → 100                                                      |
| Lighthouse                      | `/favicon.ico` 404 in console                                                    | `app/icon.svg`                                                          | best practices 96 → 100                                                     |
| Lighthouse                      | render-blocking CSS (est. 150 ms on mobile)                                      | `experimental.inlineCss`                                                | no CSS request                                                              |
| Lighthouse                      | desktop LCP element = side-panel hint text, painted late (615 ms in 2 of 3 runs) | server-rendered lead text in the main column                            | desktop LCP 209 ms in 3 of 3 runs                                           |
| bundle measurement              | try: lazy-load betslip, metrics and event panel                                  | measured: −2.5 KB initial, +3.9 KB total                                | **reverted** (D28)                                                          |
| `pnpm start` (Day 7)            | gateway crashed (stack overflow) when it started before feed-sim                 | reconnect from `error` or `close`, once per socket                      | all services start in any order; test added                                 |
| e2e (Day 8)                     | betslip "reset" showed `€NaN`: empty body sent as JSON, bet-api answered 400     | no JSON content type without a body; non-2xx → no balance update        | reset works; e2e test resets after a placed bet (D39)                       |
| paint measurement (Day 8)       | try: stream the page shell with `<Suspense>`                                     | measured: FCP −36…−180 ms, phone LCP +270 ms                            | **reverted** (D38)                                                          |

## Web: optimisation pass (Day 8), before / after

"Before" = commit `d13f83a` (Day 7), "after" = Day 8 working tree. Both production builds,
`next start`, same feed-sim / gateway / bet-api processes, feed at 200 ticks/s. Port 3000 was taken
by another app on this machine, so the web servers ran on other ports (`WEB_PORT=3002 pnpm e2e`).
"+300 ms gateway" = the Next.js server reads snapshots through `e2e/delay-proxy.mjs`, to simulate
network distance between web server and gateway. Raw: `e2e/results/opt-before/`,
`e2e/results/opt-after/`, `e2e/results/opt-compare/`.

```bash
node e2e/delay-proxy.mjs --port 7012 --delay 300
GATEWAY_HTTP=http://127.0.0.1:7012 pnpm --filter @liveline/web exec next start -p 3003
node e2e/measure-bundle.mjs http://localhost:3002/?sport=1
node e2e/measure-paint.mjs --url http://localhost:3002/?sport=1 --runs 10 --mobile --gap 1200
node load/page-load.mjs --url http://localhost:3002/?sport=1 --rate 50 --duration 30
node e2e/measure-runtime.mjs --url http://localhost:3002/?sport=1 --rate 500 --cpu 4
# Lighthouse: the commands of the Lighthouse section, with --url=http://localhost:3002/?sport=1
```

**1. Server HTML carries only the first 30 rows** (was: the whole sport, in the HTML and again in
the RSC payload). The WebSocket snapshot fills the rest right after hydration (D36).

| Football page                                              | before   | after    |
| ---------------------------------------------------------- | -------- | -------- |
| HTML document, raw                                         | 317.2 KB | 110.0 KB |
| HTML document, gzip                                        | 35.4 KB  | 15.7 KB  |
| phone¹: whole HTML received (`responseEnd`), median of 10  | 332 ms   | 232 ms   |
| phone¹: DOMContentLoaded end (hydration can start), median | 339 ms   | 241 ms   |
| phone¹, +300 ms gateway: DOMContentLoaded end, median      | 526 ms   | 409 ms   |
| phone¹: LCP (team name in the first row), median           | 256 ms   | 260 ms   |

¹ `measure-paint.mjs --mobile`: real Chrome, 412×823, 150 ms RTT, 1.6 Mbit/s, 4× CPU slowdown, cold
server cache (`--gap 1200`). LCP does not change: the first rows are at the start of the HTML; the
removed data was at the end. What gets faster is everything after the HTML: script start and
hydration, ~100 ms on this profile.

**2. Streaming the shell with `<Suspense>`: tried, measured, reverted** (D38). Same phone profile:

| with `<Suspense>` around the rows | FCP (before → with) | LCP (before → with) |
| --------------------------------- | ------------------- | ------------------- |
| gateway direct                    | 260 → 224 ms        | 264 → **536 ms**    |
| +300 ms gateway                   | 408 → 228 ms        | 408 → **536 ms**    |

The first paint (header, lead text) came earlier, but the rows ~270 ms later in both cases. In
Lighthouse mobile with the +300 ms gateway, LCP was 2 649 ms (simulated). Raw files of this run were
overwritten by the final run; the numbers are from its console output.

**3. 1-second server cache for the snapshot** (D36). `page-load.mjs`, 50 page requests/s for 30 s:

| GET /?sport=1   | before: p50 / p95 / p99  | after: p50 / p95 / p99 | gateway snapshot requests |
| --------------- | ------------------------ | ---------------------- | ------------------------- |
| gateway direct  | 10.5 / 12.7 / 17.7 ms    | 5.4 / 7.2 / 10.9 ms    | not counted               |
| +300 ms gateway | 311.6 / 316.3 / 333.3 ms | 5.8 / 327.3 / 367.5 ms | 1 500 → 30 (1 per second) |

"After" includes change 1 (smaller page). With a slow gateway, requests that arrive while the
cache refreshes wait for that one request (p95/p99); all others are served from memory.

**4. One store subscription per odds button** (was two: price and market status). **5. Own window
virtualizer** instead of `@tanstack/react-virtual` (D37). Runtime, same machine, same run conditions
(`measure-runtime.mjs --rate 500 --cpu 4`, raw `e2e/results/opt-compare/runtime-*`):

| build  | FPS idle / scroll | frame p95 scroll | long tasks idle / scroll | sport switch worst | INP   |
| ------ | ----------------- | ---------------- | ------------------------ | ------------------ | ----- |
| before | 60 / 60.2         | 16.7 ms          | 0 / 0                    | 32 ms              | 72 ms |
| after  | 60 / 60.1         | 16.8 ms          | 0 / 0                    | 32 ms              | 32 ms |

No runtime change beyond noise: the "before" INP was 32 ms in the Day 6 run, and 72 ms (one
interaction, one long task) in this one. Change 4 is too small to measure here (≈ 30 ops/s reach
the store). Change 5 removed 9.2 KB gzip of initial JS (table above) and fixed a first-paint layout
problem: in the server HTML, before JavaScript runs, rows overlapped by up to 63 px on a 390 px phone
(3 px on desktop) because positions used one estimated height; now 0 px on every width (checked
with Playwright, JavaScript disabled, 21 rows).

A first version of change 5 put rows in normal flow between spacer elements. Lighthouse mobile then
showed CLS 0.137 in 2 of 3 runs: when the top live event ends, every row moves up one row, and in
normal flow that counts as layout shift. The library moved rows with `transform`, which the Layout
Instability API does not count. The final version positions rows with `transform` too (same visible
movement as before), and CLS is 0 again.

Lighthouse (3 runs each, median, `lighthouse.txt` in the raw folders): unchanged within noise.
Mobile LCP 794 → 784 ms, desktop 209 → 211 ms, +300 ms gateway mobile 808 → 788 ms; 100/100/100
and CLS 0 in all of them.

## Bet API: POST /bets (k6, Docker)

Each request is a new single bet (new `Idempotency-Key`, `acceptChanges: any`, stake 1 cent) on a
random open main market of a prematch event. SQLite file DB in WAL mode, one Node process.

```bash
cd load
docker run --rm -i --add-host=host.docker.internal:host-gateway -v "$PWD:/scripts" \
  -e RATE=200 -e DURATION=30s grafana/k6:0.54.0 run /scripts/k6/bets.js
# same with RATE=1000
```

| rate   | requests | accepted | rejected (409/422) | p50     | p95     | p99     | max     |
| ------ | -------- | -------- | ------------------ | ------- | ------- | ------- | ------- |
| 200/s  | 6 004    | 6 000    | 1                  | 0.83 ms | 1.29 ms | 2.15 ms | 11.3 ms |
| 1000/s | 30 004   | 29 995   | 6                  | 0.43 ms | 3.21 ms | 7.32 ms | 16.8 ms |

Rejections are real state changes during the run (market suspended / event closed), not errors.
(k6 counts them in `http_req_failed` because they are not 2xx.) Raw: `load/results/k6-bets-*.json`.

## End-to-end tests

```bash
pnpm build && pnpm e2e     # Playwright, system Chrome
WEB_PORT=3002 pnpm e2e     # when port 3000 is taken (Day 8 run: 8 passed, 14.1 s)
```

8 tests pass (13.1 s): server-rendered rows in HTML, live odds updates, event panel, sport switch,
single bet, multiple bet, toggle selection, balance loads after the bet service was unreachable.
One earlier run had 1 failure: the stack had just started and bet-api was not up yet when the page
loaded, so the balance stayed empty. Fixed in the app (balance request retries with backoff) and
covered by the last test.
