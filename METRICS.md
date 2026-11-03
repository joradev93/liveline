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
