import type { PlaceBetRequest, PlaceBetResponse } from '@liveline/protocol';
import { BET_API_URL } from './config';

const USER_KEY = 'liveline:user';

/** Demo identity: a random id per browser, so every visitor has their own mock balance. */
export function userId(): string {
  try {
    let id = localStorage.getItem(USER_KEY);
    if (!id) {
      id = `u-${crypto.randomUUID().slice(0, 12)}`;
      localStorage.setItem(USER_KEY, id);
    }
    return id;
  } catch {
    return 'demo';
  }
}

const identity = () => ({ 'x-user-id': userId() });

/**
 * Places one bet. The idempotency key belongs to this attempt: network failures are retried
 * with the same key, so a bet is never placed twice even if a response was lost.
 */
export async function placeBet(
  request: PlaceBetRequest,
  idempotencyKey: string,
  retries = 2,
): Promise<PlaceBetResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${BET_API_URL}/bets`, {
        method: 'POST',
        headers: {
          ...identity(),
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify(request),
      });
      return (await res.json()) as PlaceBetResponse;
    } catch (error) {
      if (attempt >= retries) throw error;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
}

export const fetchBalance = () => balanceRequest('/me', 'GET');

export const resetBalance = () => balanceRequest('/me/reset', 'POST');

/**
 * Balance in cents, or null when the service is not reachable or answers with an error.
 * No JSON content type here: the requests have no body, and Fastify rejects an empty JSON body.
 */
async function balanceRequest(path: string, method: 'GET' | 'POST'): Promise<number | null> {
  try {
    const res = await fetch(`${BET_API_URL}${path}`, { method, headers: identity() });
    if (!res.ok) return null;
    const { balanceCents } = (await res.json()) as { balanceCents?: unknown };
    return typeof balanceCents === 'number' ? balanceCents : null;
  } catch {
    return null;
  }
}
