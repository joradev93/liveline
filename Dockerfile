# syntax=docker/dockerfile:1
#
# One image per Node service:
#   docker build --build-arg APP=feed-sim -t liveline-feed .
#   docker build --build-arg APP=gateway  -t liveline-gateway .
#   docker build --build-arg APP=bet-api  --build-arg RUN_AS=root -t liveline-bet-api .
#
# The app bundle (tsup) already contains the workspace packages; scripts/pack-app.mjs writes a
# package.json with only the external runtime dependencies (uWebSockets.js, better-sqlite3, ...).

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG APP
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@liveline/${APP}..."
RUN pnpm --filter "@liveline/${APP}" build
RUN node scripts/pack-app.mjs "${APP}" /out && cd /out && npm install --omit=dev --no-audit --no-fund

FROM node:${NODE_VERSION}-bookworm-slim
# bet-api writes SQLite to a mounted volume, which is root-owned on Fly.io: build it with RUN_AS=root.
ARG RUN_AS=node
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER ${RUN_AS}
CMD ["node", "dist/index.js"]
