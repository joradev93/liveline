import { MAX_TICK_RATE, MIN_TICK_RATE } from '@liveline/protocol';
import { FEED_HTTP_URL } from '@/lib/config';

/**
 * Load slider proxy: the browser never talks to feed-sim directly.
 * Set LOAD_CONTROL=off to make the demo read-only.
 */
const enabled = process.env.LOAD_CONTROL !== 'off';

export async function GET() {
  try {
    const res = await fetch(`${FEED_HTTP_URL}/rate`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1_000),
    });
    return Response.json({ ...(await res.json()), enabled });
  } catch {
    return Response.json({ rate: null, enabled: false }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (!enabled) return Response.json({ error: 'load control is disabled' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { rate?: unknown };
  const rate = Number(body.rate);
  if (!Number.isFinite(rate) || rate < MIN_TICK_RATE || rate > MAX_TICK_RATE) {
    return Response.json(
      { error: `rate must be ${MIN_TICK_RATE}-${MAX_TICK_RATE}` },
      { status: 400 },
    );
  }
  try {
    const token = process.env.FEED_CONTROL_TOKEN;
    const res = await fetch(`${FEED_HTTP_URL}/rate`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify({ rate }),
      signal: AbortSignal.timeout(1_000),
    });
    return Response.json(await res.json());
  } catch {
    return Response.json({ error: 'feed not reachable' }, { status: 503 });
  }
}
