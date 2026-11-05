# Deploy

Deployed on 2026-11-05. Live: <https://liveline-zeta.vercel.app>

| service  | host                                      | URL                                      |
| -------- | ----------------------------------------- | ---------------------------------------- |
| web      | Vercel, project `liveline`, region `fra1` | <https://liveline-zeta.vercel.app>       |
| gateway  | Fly.io `liveline-gateway`, region `ams`   | `wss://liveline-gateway.fly.dev/ws`      |
| bet-api  | Fly.io `liveline-bet-api`, region `ams`   | <https://liveline-bet-api.fly.dev>       |
| feed-sim | Fly.io `liveline-feed`, region `ams`      | <https://liveline-feed.fly.dev> (tokens) |

Checked after the deploy: all three `/health` endpoints return `{"ok":true}`, and the Playwright
suite passes against the live site (12/12 after the redeploy on 2026-11-05):

```bash
cd e2e && E2E_BASE_URL=https://liveline-zeta.vercel.app pnpm exec playwright test
```

## Topology

| service  | public               | notes                                                   |
| -------- | -------------------- | ------------------------------------------------------- |
| web      | yes                  | Next.js App Router, root directory `apps/web`           |
| gateway  | yes (WSS)            | uWebSockets.js, compression off (as measured)           |
| bet-api  | yes (HTTPS)          | SQLite on a 1 GB volume, one machine                    |
| feed-sim | yes, token-protected | gateway and bet-api use the private `.internal` address |

Every Fly app runs exactly **one** machine (`--ha=false`): two feed-sim machines would be two
independent feeds with different prices, and SQLite allows one writer.

## Fly.io (from the repo root)

```bash
fly apps create liveline-feed --org personal
fly apps create liveline-gateway --org personal
fly apps create liveline-bet-api --org personal

fly secrets set --stage -a liveline-feed FEED_CONTROL_TOKEN=... FEED_BUS_TOKEN=...
fly secrets set --stage -a liveline-gateway FEED_URL="ws://liveline-feed.internal:8080/feed?token=<FEED_BUS_TOKEN>"
fly secrets set --stage -a liveline-bet-api FEED_URL="ws://liveline-feed.internal:8080/feed?token=<FEED_BUS_TOKEN>"
fly volumes create bets -a liveline-bet-api --region ams --size 1

# One build at a time: parallel remote builds failed with "error reading from server: EOF".
fly deploy -c deploy/fly/feed-sim.toml --ha=false --remote-only
fly deploy -c deploy/fly/bet-api.toml  --ha=false --remote-only
fly deploy -c deploy/fly/gateway.toml  --ha=false --remote-only
```

Check a config before deploying; `--strict` reports keys that flyctl silently ignores:

```bash
fly config validate --strict -c deploy/fly/gateway.toml
```

Machines: `shared-cpu-1x`, 256 MB RAM, 256 MB swap. Memory after the deploy, at 200 ticks/s with
a few clients (`VmRSS` of the Node process and `/proc/meminfo`, read with `fly ssh console`):

| app              | Node RSS | MemTotal | MemAvailable |
| ---------------- | -------- | -------- | ------------ |
| liveline-feed    | 95.2 MB  | 209.9 MB | 109.3 MB     |
| liveline-gateway | 90.5 MB  | 209.9 MB | 116.2 MB     |
| liveline-bet-api | 97.9 MB  | 209.9 MB | 109.9 MB     |

```bash
fly ssh console -a liveline-gateway -C "sh -c 'for p in /proc/[0-9]*; do grep -q dist/index.js \$p/cmdline 2>/dev/null && grep VmRSS \$p/status; done; grep -E \"MemTotal|MemAvailable|SwapTotal\" /proc/meminfo'"
```

The gateway needed up to 173 MB RSS in the local load tests with 500–10 000 clients (METRICS.md).
Before a load test on Fly: `fly scale memory 512 -a liveline-gateway`.

## Vercel

Project `liveline`, root directory `apps/web`, Node 22.x, linked from the repo root
(`vercel link --project liveline`, writes `.vercel/`, which is gitignored). `apps/web/vercel.json`
pins the function region to `fra1`, next to the Fly apps in `ams`: the RSC snapshot fetch is on the
LCP path.

| variable                 | value                               | used by                   |
| ------------------------ | ----------------------------------- | ------------------------- |
| `NEXT_PUBLIC_GATEWAY_WS` | `wss://liveline-gateway.fly.dev/ws` | browser (worker)          |
| `NEXT_PUBLIC_BET_API`    | `https://liveline-bet-api.fly.dev`  | browser (betslip)         |
| `GATEWAY_HTTP`           | `https://liveline-gateway.fly.dev`  | RSC snapshot fetch        |
| `FEED_HTTP`              | `https://liveline-feed.fly.dev`     | `/api/load` (load slider) |
| `FEED_CONTROL_TOKEN`     | same as on feed-sim (sensitive)     | `/api/load`               |
| `LOAD_CONTROL`           | not set (= on); `off` = read-only   | `/api/load`               |

`NEXT_PUBLIC_*` values are inlined at build time: change them, then deploy again.

```bash
vercel deploy --prod
```

`WEB_ORIGIN` on bet-api (`deploy/fly/bet-api.toml`) must list the Vercel URL, or the browser's
CORS preflight for `POST /bets` fails.

## Fixed during the first deploy

| problem                                                                       | fix                                                                    |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `npm error syscall spawn git`: uWebSockets.js is a GitHub dependency          | `git` in the build stage                                               |
| `gyp ERR!` for better-sqlite3: no prebuilt binary, no compiler                | `python3`, `make`, `g++` in the build stage                            |
| gateway crash: uWS binary needs `GLIBC_2.38`, Debian 12 (bookworm) has 2.36   | base image `node:22-trixie-slim` (Debian 13)                           |
| `swap_size_mb` after a `[[http_service.checks]]` table belonged to that table | moved to the top of each toml; `fly config validate --strict` shows it |
| Fly trial stops machines after 5 minutes                                      | a card on the account                                                  |

## Notes

- The load slider is shared by every viewer. For a read-only demo set `LOAD_CONTROL=off` on Vercel.
- Fly has no spending limit; prepaid credits only pay the monthly bill first. Stop the backend when
  it is not needed: `fly scale count 0 -a <app>` (the volume stays).
- Phase 2 (not done): Redis pub/sub between feed-sim and 2+ gateway instances.
