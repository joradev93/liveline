#!/bin/sh
# One load step: restarts the gateway (fresh counters), samples its CPU/RSS every 5 s,
# runs k6 with $VUS connections, and saves k6 summary + gateway stats to load/results/.
# Needs feed-sim running on :7001 and a built gateway (pnpm build).
#   VUS=2000 RAMP=40s HOLD=60s sh load/step.sh
set -e
cd "$(dirname "$0")/.."
VUS="${VUS:-500}"
pkill -f "apps/gateway/dist/index.js" || true
sleep 0.5
GW_LOG=quiet node apps/gateway/dist/index.js > load/results/gw.log 2>&1 &
GW=$!
sleep 1.5
( while kill -0 $GW 2>/dev/null; do ps -o %cpu=,rss= -p $GW; sleep 5; done ) > "load/results/gw-cpu-$VUS.txt" &
VUS="$VUS" sh load/k6.sh --quiet --summary-export "/scripts/results/k6-$VUS.json" || true
curl -s localhost:7002/stats > "load/results/gw-stats-$VUS.json"
kill $GW
