# Deploy

Nothing here has been deployed yet. The configs were written but **not tested** on Fly.io/Vercel
(no accounts), and the Docker build itself was not run (no Node base image was pulled).
What was tested: `scripts/pack-app.mjs` + `npm install --omit=dev` (the Dockerfile's packaging step)
for all three services, started from the packed folders with a feed bus token. Test the image first:

```bash
docker build --build-arg APP=gateway -t liveline-gateway .
docker run --rm -p 7002:8080 -e GW_PORT=8080 -e FEED_URL=ws://host.docker.internal:7001/feed liveline-gateway
```

## Topology

| service  | host                                           | public               | notes                                                   |
| -------- | ---------------------------------------------- | -------------------- | ------------------------------------------------------- |
| web      | Vercel (`apps/web`, root directory `apps/web`) | yes                  | Next.js App Router                                      |
| gateway  | Fly.io `liveline-gateway`                      | yes (WSS)            | uWebSockets.js, compression off (as measured)           |
| bet-api  | Fly.io `liveline-bet-api`                      | yes (HTTPS)          | SQLite on a 1 GB volume, one machine                    |
| feed-sim | Fly.io `liveline-feed`                         | yes, token-protected | gateway and bet-api use the private `.internal` address |

## Order

1. `deploy/fly/feed-sim.toml` (set `FEED_CONTROL_TOKEN`, `FEED_BUS_TOKEN`)
2. `deploy/fly/gateway.toml`, `deploy/fly/bet-api.toml` (set `FEED_URL` with the bus token)
3. Vercel project, root directory `apps/web`, environment variables:

| variable                 | example                             | used by                   |
| ------------------------ | ----------------------------------- | ------------------------- |
| `NEXT_PUBLIC_GATEWAY_WS` | `wss://liveline-gateway.fly.dev/ws` | browser (worker)          |
| `NEXT_PUBLIC_BET_API`    | `https://liveline-bet-api.fly.dev`  | browser (betslip)         |
| `GATEWAY_HTTP`           | `https://liveline-gateway.fly.dev`  | RSC snapshot fetch        |
| `FEED_HTTP`              | `https://liveline-feed.fly.dev`     | `/api/load` (load slider) |
| `FEED_CONTROL_TOKEN`     | same as on feed-sim                 | `/api/load`               |
| `LOAD_CONTROL`           | `off` to make the slider read-only  | `/api/load`               |

4. Set `WEB_ORIGIN` on bet-api to the Vercel URL.

## Notes

- Region: put all Fly apps and the Vercel function region close together (e.g. `ams` / `fra1`); the
  RSC snapshot fetch is on the LCP path.
- The load slider is shared by every viewer. For a public demo consider `LOAD_CONTROL=off` or a
  lower `MAX_TICK_RATE`.
- Phase 2 (not done): Redis pub/sub between feed-sim and 2+ gateway instances.
