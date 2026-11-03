# Blockers

Things that could not be done as specified, and the workaround.

## B1. uWebSockets.js v20.71.0 ESM entry is broken

- **Problem:** `import uWS from 'uWebSockets.js'` fails: the package's `ESM_wrapper.mjs` imports
  `./index.js`, which is not in the release (the CommonJS entry is `uws.js`).
- **Workaround:** `apps/gateway/src/uws.ts` loads the CommonJS entry with `createRequire`. Types still
  come from the package. No functional difference.
- **Status:** worked around. Remove `uws.ts` when upstream fixes the wrapper.
