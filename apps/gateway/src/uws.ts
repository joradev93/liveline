/**
 * uWebSockets.js v20.71.0 ships a broken ESM wrapper (it imports a missing `./index.js`),
 * so load the CommonJS entry directly. See BLOCKERS.md.
 */
import { createRequire } from 'node:module';
import type * as UWS from 'uWebSockets.js';

const require = createRequire(import.meta.url);
const uWS = require('uWebSockets.js') as typeof UWS;

export default uWS;
export type { UWS };
