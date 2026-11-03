# Liveline — project context

Live sportsbook demo for a portfolio. It shows, with measured numbers, a real-time betting
product end to end: **feed → gateway → client → bet placement**.

All data is synthetic. Never use third-party or real operator APIs/data (no BetConstruct/Swarm,
no real teams from a real feed).

## Architecture

```
apps/feed-sim  ──feed bus (WS :7001)──►  apps/gateway (uWebSockets.js :7002) ──WS──► apps/web (Next.js :3000)
       │                                                                                   │
       └──────────feed bus──────────►  apps/bet-api (Fastify + SQLite :7003) ◄──── POST /bets
```

- `packages/protocol` — shared TypeScript types + zod schemas (client WS protocol, feed bus, bet API).
- `apps/feed-sim` — seeded synthetic events/markets, random-walk odds, lifecycle, tick rate 50–2000/s.
  Serves the feed bus (snapshot + ordered batches) and `GET/POST /rate`.
- `apps/gateway` — in-memory state, monotonic version per topic (`sport:{id}`, `event:{id}`),
  per-topic coalescing flushed every 100 ms, backpressure skip, client-driven resync.
- `apps/bet-api` — `POST /bets` with odds validation (`none | higher | any`), `Idempotency-Key`,
  mock balance, SQLite.
- `apps/web` — Next.js App Router, React 19. RSC first paint, WS + JSON parsing in a Web Worker,
  `useSyncExternalStore` per-market selectors, virtualized list, betslip, metrics panel.
- `load/` — k6 scripts (run via Docker image `grafana/k6`), `e2e/` — Playwright.

## Conventions

- TypeScript strict everywhere, ESM, Node 22. pnpm workspaces + Turborepo.
- Internal packages export TS source; Node apps are bundled with tsup for production, run with tsx in dev.
- Pure logic lives in small classes/functions with no I/O so it can be unit tested
  (e.g. gateway `TopicHub`, bet-api `validateBet`, web `applyDelta`).
- Tests: vitest. Required coverage areas: protocol schemas, gateway coalescing/resync, bet validation.
- Metrics: every number in README/METRICS.md must be measured, with the command used. Never invent
  or round up numbers. If not measured, say "not measured".
- Decisions go to DECISIONS.md (what, why, alternatives). Blockers go to BLOCKERS.md.
- Never push, never deploy, never install anything globally.

## Commands

```bash
pnpm install
pnpm build        # all packages/apps
pnpm test         # vitest in every package
pnpm lint
pnpm typecheck
pnpm dev          # feed-sim, gateway, bet-api, web together
```

## Plan (7 days)

1. Monorepo, protocol package, feed-sim (ticks visible in console)
2. Gateway: state, versions, subscriptions, snapshot/delta (verify with a WS client script)
3. Coalescing, backpressure, resync, first k6 run
4. Client: RSC snapshot, worker, store, virtualized list
5. Betslip + bet API with odds validation and idempotency
6. Metrics panel, Lighthouse CI, profiler-driven fixes
7. README (diagram + numbers), deploy configs (web → Vercel, gateway + bet-api → Fly.io), demo GIF script

Phase 2 (not now): Redis pub/sub between feed-sim and 2+ gateway instances.
