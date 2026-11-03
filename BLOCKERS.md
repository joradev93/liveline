# Blockers

Things that could not be done as specified, and the workaround.

## B1. uWebSockets.js v20.71.0 ESM entry is broken

- **Problem:** `import uWS from 'uWebSockets.js'` fails: the package's `ESM_wrapper.mjs` imports
  `./index.js`, which is not in the release (the CommonJS entry is `uws.js`).
- **Workaround:** `apps/gateway/src/uws.ts` loads the CommonJS entry with `createRequire`. Types still
  come from the package. No functional difference.
- **Status:** worked around. Remove `uws.ts` when upstream fixes the wrapper.

## B2. One macOS machine cannot open more than ~16 000 client sockets

- **Problem:** the max-clients test stopped at 15 000: a 20 000 run failed with `EADDRNOTAVAIL` on the
  client side (macOS uses one ephemeral port range, 49152–65535, for all destinations).
- **Workaround:** none without changing system settings (out of scope). The gateway was at ~48% of one
  core at 15 000 clients, so its real limit is higher. To measure it: run the load generator on 2+
  machines, or on Linux with a wider `ip_local_port_range`.

## B3. Homebrew ffmpeg is broken on this machine

- **Problem:** `/opt/homebrew/bin/ffmpeg` fails to start: `Library not loaded: libx265.216.dylib`.
  Fixing it needs `brew reinstall ffmpeg` (a global change, out of scope).
- **Workaround:** GIF built in JS (D35). Playwright video recording was also not used: it needs a
  Playwright-specific ffmpeg download into `~/Library/Caches`.

## B4. Docker build and deploy configs not tested

- **Problem:** no Node base image is available locally, and pulling one was not approved (only the k6
  image was). No Fly.io / Vercel accounts.
- **Workaround:** the packaging step of the Dockerfile was tested without Docker (D33). The GitHub
  Actions workflow was also never run (no remote).
