# Good morning — status of the overnight run

All 7 days are done. Everything is committed **locally** on `master` (one commit per day).
Nothing was pushed, nothing was deployed, nothing was installed globally.

## Commits

| commit | content                                                                            |
| ------ | ---------------------------------------------------------------------------------- |
| day 1  | monorepo, protocol package, feed-sim                                               |
| day 2  | gateway: state, versions, subscriptions, snapshot/delta, coalescing                |
| day 3  | real backpressure test, resync, k6 + Node load generator, METRICS.md               |
| day 4  | Next.js client: RSC snapshot, feed worker, store, virtualized list                 |
| day 5  | bet API (validation, idempotency) + betslip + Playwright e2e                       |
| day 6  | metrics panel, load slider, Lighthouse CI, fixes from measurements, GitHub Actions |
| day 7  | README + demo GIF, deploy configs (not deployed), startup bug fix, this file       |

Review with `git log --stat` and `git show <commit>`.

## How to run

```bash
pnpm install
pnpm build
pnpm start                 # feed-sim :7001, gateway :7002, bet-api :7003, web :3000
open http://localhost:3000
```

Dev mode: `pnpm dev`. Checks: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`.
E2E (stack must be built; it reuses running servers): `pnpm e2e`.

## Measured (details and commands in METRICS.md)

| target                       | result                                                                        | status                |
| ---------------------------- | ----------------------------------------------------------------------------- | --------------------- |
| p99 tick→client < 150 ms     | 113 ms @ 2 000 clients, 134 ms @ 5 000 (k6), 149 ms @ 15 000 (Node generator) | met                   |
| max clients per gateway      | 15 000 within target, gateway at ~48% of one core                             | lower bound only (B2) |
| LCP < 1.5 s                  | 790 ms mobile, 209 ms desktop; Lighthouse 100/100/100 both                    | met                   |
| INP < 100 ms @ 500 ticks/s   | 32 ms (also with 4× CPU slowdown and at 2 000 ticks/s)                        | met                   |
| ~60 FPS scrolling under load | 60.1–60.3 FPS, 0 long tasks                                                   | met                   |
| initial JS < 120 KB gzip     | 154.7 KB gzip / 133.0 KB brotli; framework alone is 128.9 KB                  | **missed** (D28)      |
| bet placement                | p99 2.15 ms @ 200/s, 7.32 ms @ 1 000/s                                        | —                     |

Tests: 80 unit/integration tests (vitest) + 8 e2e tests (Playwright), all passing at the last run.

## Open issues — please check

1. **Initial JS target missed.** Next.js 16 + React 19 alone are above 120 KB gzip. I reported it as
   missed instead of changing the stack. Options are in DECISIONS.md D28.
2. **Not tested: Docker build, Fly.io/Vercel configs, GitHub Actions.** No base image pulled (only the
   k6 image was approved), no accounts, no remote. The packaging step was tested without Docker.
   First thing to try: `docker build --build-arg APP=gateway -t liveline-gateway .` (see deploy/README.md).
3. **Max clients is a lower bound.** macOS cannot open more than ~16 000 client sockets from one
   machine. To find the real limit, run `load/swarm.mjs` from 2+ machines against one gateway.
4. **uWebSockets.js v20.71.0 has a broken ESM entry.** Worked around with `createRequire` (BLOCKERS B1).
5. **Your Homebrew ffmpeg is broken** (missing `libx265`), not related to this repo. `brew reinstall ffmpeg`
   fixes it if you need it. The GIF was made without it.
6. **Load slider is shared** by every viewer. For a public demo set `LOAD_CONTROL=off` on Vercel, or keep
   it on with a token (deploy/README.md).
7. **Commit policy:** your global rules say "no commits without approval", but the task asked for one
   commit per day, so I committed per day (local only). If you prefer, `git reset --soft <first>` gives
   you everything back as uncommitted changes.

## Bugs found and fixed during the run

- Gateway: a client skipped under backpressure stayed stale on quiet topics (randomized test) → catch-up snapshot.
- Gateway/bet-api: crash ("Maximum call stack size exceeded") when started before feed-sim → reconnect fix + test.
- Web: balance stayed empty if bet-api started after the page → retry with backoff + e2e test.
- Web (Lighthouse): two badge contrast issues, favicon 404, render-blocking CSS, late LCP element.

## What I would do next

1. Deploy (Fly.io + Vercel) and repeat the k6 run against the real gateway from another region; put the
   real-network numbers next to the local ones in the README.
2. Gateway fan-out: use uWS native `publish()` for clients that are in sync and keep the JS loop only
   for lagging ones. At 15 000 clients the flush loop (82 ms max) is what pushes p99 up, not CPU.
3. Phase 2: Redis pub/sub between feed-sim and 2+ gateway instances, with the same version/resync logic.
4. Measure `permessage-deflate` (bandwidth vs gateway CPU) before turning it on for the public demo.
5. Smaller initial JS: trim the RSC payload (the snapshot is sent twice: HTML + flight data) and test a
   lighter client (e.g. Preact) on a branch, to see what the 120 KB target would really cost.
