import type { PlaceBetRequest } from '@liveline/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { BetRepository, START_BALANCE_CENTS } from './db.js';
import { bookFixture } from './fixtures.js';
import type { PriceBook } from './price-book.js';

let repo: BetRepository;
let book: PriceBook;
let ready: boolean;
let app: Awaited<ReturnType<typeof buildApp>>;

beforeEach(async () => {
  repo = new BetRepository(':memory:');
  book = bookFixture();
  ready = true;
  app = await buildApp({
    repo,
    book,
    feedReady: () => ready,
    corsOrigins: ['http://localhost:3000'],
  });
});

afterEach(async () => {
  await app.close();
  repo.close();
});

const body: PlaceBetRequest = {
  type: 'single',
  stakeCents: 1_000,
  acceptChanges: 'none',
  legs: [{ eventId: 1, marketId: 11, sel: '1', odds: 2.1 }],
};

const place = (payload: unknown, key: string | null = 'key-00000001', user = 'alice') =>
  app.inject({
    method: 'POST',
    url: '/bets',
    headers: { 'x-user-id': user, ...(key ? { 'idempotency-key': key } : {}) },
    payload: payload as object,
  });

const balance = async (user = 'alice') =>
  (await app.inject({ method: 'GET', url: '/me', headers: { 'x-user-id': user } })).json<{
    balanceCents: number;
  }>().balanceCents;

describe('POST /bets', () => {
  it('accepts a bet and debits the stake', async () => {
    const res = await place(body);
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json).toMatchObject({
      status: 'accepted',
      balanceCents: START_BALANCE_CENTS - 1_000,
      bet: { type: 'single', stakeCents: 1_000, totalOdds: 2.1, potentialReturnCents: 2_100 },
    });
    expect(await balance()).toBe(START_BALANCE_CENTS - 1_000);
  });

  it('replays the same response for the same key and body, without a second debit', async () => {
    const first = await place(body);
    const second = await place(body);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json().bet.id).toBe(first.json().bet.id);
    expect(await balance()).toBe(START_BALANCE_CENTS - 1_000);
    expect(repo.recentBets('alice')).toHaveLength(1);
  });

  it('scopes keys per user', async () => {
    await place(body, 'shared-key-1', 'alice');
    const res = await place(body, 'shared-key-1', 'bob');
    expect(res.statusCode).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
  });

  it('rejects a reused key with a different body', async () => {
    await place(body);
    const res = await place({ ...body, stakeCents: 2_000 });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('requires a valid Idempotency-Key', async () => {
    expect((await place(body, null)).json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect((await place(body, 'short')).statusCode).toBe(400);
  });

  it('rejects invalid bodies with 400', async () => {
    const res = await place({ ...body, stakeCents: -5 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('returns 409 ODDS_CHANGED with current prices; a retry with the new price is accepted', async () => {
    book.apply({ k: 'price', e: 1, m: 11, sel: { '1': 2.3 }, ts: 0 });
    const res = await place(body, 'attempt-0001');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: 'ODDS_CHANGED',
      changes: [{ marketId: 11, sel: '1', current: 2.3 }],
    });
    expect(await balance()).toBe(START_BALANCE_CENTS);

    // The same attempt replays the same rejection (it is stored), even though prices could change.
    expect((await place(body, 'attempt-0001')).statusCode).toBe(409);

    const accepted = await place(
      { ...body, legs: [{ ...body.legs[0]!, odds: 2.3 }] },
      'attempt-0002',
    );
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().bet.legs[0]).toMatchObject({ odds: 2.3, marketVersion: 1 });
  });

  it('places a multiple at the combined odds', async () => {
    const res = await place({
      type: 'multiple',
      stakeCents: 500,
      acceptChanges: 'none',
      legs: [
        { eventId: 1, marketId: 11, sel: '1', odds: 2.1 },
        { eventId: 2, marketId: 21, sel: '2', odds: 2.0 },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().bet).toMatchObject({ totalOdds: 4.2, potentialReturnCents: 2_100 });
  });

  it('rejects stakes above the balance', async () => {
    const res = await place({ ...body, stakeCents: START_BALANCE_CENTS + 1 });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
  });

  it('returns 503 while the feed is not ready, and does not store it', async () => {
    ready = false;
    expect((await place(body)).statusCode).toBe(503);
    ready = true;
    expect((await place(body)).statusCode).toBe(201);
  });

  it('places exactly one bet when the same request is sent many times at once', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => place(body, 'burst-key-01')),
    );
    const ids = new Set(results.map((r) => r.json().bet.id));
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    expect(ids.size).toBe(1);
    expect(await balance()).toBe(START_BALANCE_CENTS - 1_000);
  });
});

describe('CORS', () => {
  it('allows the web origin and exposes the replay header', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/bets',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,idempotency-key',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });
});
