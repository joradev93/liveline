/** Public endpoints (browser). */
export const GATEWAY_WS_URL = process.env.NEXT_PUBLIC_GATEWAY_WS ?? 'ws://localhost:7002/ws';
export const BET_API_URL = process.env.NEXT_PUBLIC_BET_API ?? 'http://localhost:7003';

/** Server-only endpoints (RSC, route handlers). */
export const GATEWAY_HTTP_URL = process.env.GATEWAY_HTTP ?? 'http://127.0.0.1:7002';
export const FEED_HTTP_URL = process.env.FEED_HTTP ?? 'http://127.0.0.1:7001';
