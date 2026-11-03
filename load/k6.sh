#!/bin/sh
# Runs load/k6/ws.js in Docker (no global k6 install). Extra args go to `k6 run`.
#   VUS=1000 RAMP=30s HOLD=60s sh load/k6.sh --summary-export /scripts/results/k6-1000.json
set -e
cd "$(dirname "$0")"
exec docker run --rm -i \
  --add-host=host.docker.internal:host-gateway \
  --ulimit nofile=100000:100000 \
  -v "$PWD:/scripts" \
  -e VUS="${VUS:-500}" -e RAMP="${RAMP:-30s}" -e HOLD="${HOLD:-60s}" \
  -e GW_URL="${GW_URL:-ws://host.docker.internal:7002/ws}" \
  -e GW_HTTP="${GW_HTTP:-http://host.docker.internal:7002}" \
  grafana/k6:0.54.0 run "$@" /scripts/k6/ws.js
