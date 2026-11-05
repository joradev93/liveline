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

FROM node:${NODE_VERSION}-trixie-slim AS build
ARG APP
# git: uWebSockets.js is a GitHub dependency. python3/make/g++: better-sqlite3 compiles from
# source when no prebuilt binary matches. Build stage only; the runtime image stays slim.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@liveline/${APP}..."
RUN pnpm --filter "@liveline/${APP}" build
RUN node scripts/pack-app.mjs "${APP}" /out && cd /out && npm install --omit=dev --no-audit --no-fund

FROM node:${NODE_VERSION}-trixie-slim
# bet-api writes SQLite to a mounted volume, which is root-owned on Fly.io: build it with RUN_AS=root.
ARG RUN_AS=node
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER ${RUN_AS}
CMD ["node", "dist/index.js"]
