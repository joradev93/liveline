import cors from '@fastify/cors';
import type { Bet, BetRejectCode, PlaceBetRequest, PlaceBetResponse } from '@liveline/protocol';
import { idempotencyKeySchema, placeBetRequestSchema } from '@liveline/protocol/schemas';
import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type { BetRepository } from './db.js';
import type { PriceBook } from './price-book.js';
import { validateBet } from './validate.js';

export interface AppDeps {
  repo: BetRepository;
  book: PriceBook;
  /** False until the first feed snapshot arrived (or while the feed is down). */
  feedReady: () => boolean;
  corsOrigins: string[];
  logger?: boolean;
}

const STATUS: Record<BetRejectCode, number> = {
  INVALID_REQUEST: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 422,
  MARKET_NOT_FOUND: 422,
  SELECTION_NOT_FOUND: 422,
  SAME_EVENT_LEGS: 422,
  INSUFFICIENT_BALANCE: 422,
  MARKET_SUSPENDED: 409,
  EVENT_CLOSED: 409,
  ODDS_CHANGED: 409,
  FEED_UNAVAILABLE: 503,
};

const USER_RE = /^[A-Za-z0-9_-]{1,64}$/;

const rejected = (code: BetRejectCode, message: string, extra: object = {}): PlaceBetResponse => ({
  status: 'rejected',
  code,
  message,
  ...extra,
});

function userOf(req: FastifyRequest): string {
  const header = req.headers['x-user-id'];
  return typeof header === 'string' && USER_RE.test(header) ? header : 'demo';
}

export async function buildApp(deps: AppDeps) {
  const { repo, book } = deps;
  const app = Fastify({ logger: deps.logger ?? false });
  await app.register(cors, {
    origin: deps.corsOrigins,
    allowedHeaders: ['content-type', 'idempotency-key', 'x-user-id'],
    exposedHeaders: ['idempotent-replayed'],
  });

  app.get('/health', async () => ({ ok: deps.feedReady() }));

  app.get('/me', async (req) => {
    const userId = userOf(req);
    return { userId, balanceCents: repo.balance(userId) };
  });

  app.post('/me/reset', async (req) => {
    const userId = userOf(req);
    return { userId, balanceCents: repo.resetBalance(userId) };
  });

  app.get('/bets', async (req) => ({ bets: repo.recentBets(userOf(req)) }));

  /**
   * Place a bet. The critical section (idempotency lookup, validation, debit, insert,
   * idempotency record) is synchronous and runs in one SQLite transaction, so two requests
   * with the same key cannot both place a bet.
   */
  app.post('/bets', (req: FastifyRequest, reply: FastifyReply) => {
    const userId = userOf(req);
    const key = idempotencyKeySchema.safeParse(req.headers['idempotency-key']);
    if (!key.success) {
      return send(
        reply,
        rejected(
          'IDEMPOTENCY_KEY_REQUIRED',
          'Send an Idempotency-Key header (8-128 chars, A-Z a-z 0-9 _ -)',
        ),
      );
    }
    const parsed = placeBetRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return send(
        reply,
        rejected(
          'INVALID_REQUEST',
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        ),
      );
    }
    const request: PlaceBetRequest = parsed.data;
    const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');

    const outcome = repo.transaction(() => {
      const stored = repo.findResponse(userId, key.data);
      if (stored) {
        if (stored.requestHash !== requestHash) {
          return {
            replay: false,
            body: rejected(
              'IDEMPOTENCY_KEY_REUSED',
              'This Idempotency-Key was used for a different request',
            ),
          };
        }
        return {
          replay: true,
          statusCode: stored.statusCode,
          body: stored.body as PlaceBetResponse,
        };
      }
      if (!deps.feedReady()) {
        return {
          replay: false,
          body: rejected('FEED_UNAVAILABLE', 'Prices are not available right now, try again'),
        };
      }

      const body = placeBet(userId, request);
      const statusCode = body.status === 'accepted' ? 201 : STATUS[body.code];
      repo.saveResponse(userId, key.data, { requestHash, statusCode, body });
      return { replay: false, statusCode, body };
    });

    if (outcome.replay) reply.header('idempotent-replayed', 'true');
    return send(reply, outcome.body, outcome.statusCode);
  });

  function placeBet(userId: string, request: PlaceBetRequest): PlaceBetResponse {
    const result = validateBet(request, book);
    if (!result.ok)
      return rejected(
        result.code,
        result.message,
        result.changes ? { changes: result.changes } : {},
      );

    const balance = repo.balance(userId);
    if (request.stakeCents > balance) {
      return rejected('INSUFFICIENT_BALANCE', `Stake is above the balance of ${balance} cents`);
    }
    const bet: Bet = {
      id: randomUUID(),
      type: request.type,
      stakeCents: request.stakeCents,
      totalOdds: result.totalOdds,
      potentialReturnCents: Math.round(request.stakeCents * result.totalOdds),
      legs: result.legs,
      placedAt: new Date().toISOString(),
    };
    const balanceCents = repo.insertBet(userId, bet);
    return { status: 'accepted', bet, balanceCents };
  }

  return app;
}

function send(reply: FastifyReply, body: PlaceBetResponse, statusCode?: number) {
  const code = statusCode ?? (body.status === 'accepted' ? 201 : STATUS[body.code]);
  return reply.code(code).send(body);
}
