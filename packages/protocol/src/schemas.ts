/**
 * zod schemas for every message that crosses a trust boundary.
 *
 * Hot paths (gateway deltas in the browser, feed batches in the gateway) are not
 * validated per message; these schemas are used at the edges (incoming client
 * messages, bet requests) and in tests.
 */
import { z } from 'zod';
import { MAX_LEGS, MAX_STAKE_CENTS } from './bets';
import { MAX_ODDS, MIN_ODDS } from './odds';

export const MAX_TOPICS_PER_MESSAGE = 50;

export const topicSchema = z.string().regex(/^(sport|event):\d{1,9}$/, 'invalid topic');

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('sub'),
    topics: z.array(topicSchema).min(1).max(MAX_TOPICS_PER_MESSAGE),
  }),
  z.object({
    t: z.literal('unsub'),
    topics: z.array(topicSchema).min(1).max(MAX_TOPICS_PER_MESSAGE),
  }),
]);

const eventStatusSchema = z.enum(['prematch', 'live', 'suspended', 'settled']);
const marketStatusSchema = z.enum(['open', 'suspended', 'settled']);
const oddsSchema = z.number().min(MIN_ODDS).max(MAX_ODDS);
const scoreSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

export const selectionSchema = z.object({ k: z.string().min(1), name: z.string(), p: oddsSchema });

export const marketSchema = z.object({
  id: z.number().int().positive(),
  eventId: z.number().int().positive(),
  type: z.enum([
    'match-result',
    'match-winner',
    'total',
    'handicap',
    'btts',
    'double-chance',
    'next-goal',
  ]),
  name: z.string(),
  line: z.number().optional(),
  status: marketStatusSchema,
  main: z.boolean(),
  sel: z.array(selectionSchema).min(2),
});

export const sportEventSchema = z.object({
  id: z.number().int().positive(),
  sportId: z.number().int().positive(),
  league: z.string(),
  home: z.string(),
  away: z.string(),
  start: z.number().int(),
  status: eventStatusSchema,
  score: scoreSchema.optional(),
  markets: z.array(marketSchema),
});

const priceMapSchema = z.record(z.string(), oddsSchema);

export const deltaOpSchema = z.union([
  z
    .object({
      m: z.number().int(),
      sel: priceMapSchema.optional(),
      st: marketStatusSchema.optional(),
    })
    .strict(),
  z
    .object({ e: z.number().int(), est: eventStatusSchema.optional(), sc: scoreSchema.optional() })
    .strict(),
  z.object({ add: sportEventSchema }).strict(),
  z.object({ rm: z.number().int() }).strict(),
]);

export const serverMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('snapshot'),
    topic: topicSchema,
    v: z.number().int().nonnegative(),
    events: z.array(sportEventSchema),
  }),
  z.object({
    t: z.literal('delta'),
    topic: topicSchema,
    from: z.number().int().nonnegative(),
    v: z.number().int().positive(),
    ops: z.array(deltaOpSchema),
    ts: z.number(),
  }),
  z.object({
    t: z.literal('counts'),
    counts: z.record(z.string().regex(/^\d{1,9}$/), z.number().int().nonnegative()),
  }),
  z.object({
    t: z.literal('error'),
    code: z.enum(['BAD_MESSAGE', 'UNKNOWN_TOPIC', 'TOO_MANY_TOPICS']),
    message: z.string(),
  }),
]);

export const feedChangeSchema = z.discriminatedUnion('k', [
  z.object({
    k: z.literal('price'),
    e: z.number(),
    m: z.number(),
    sel: priceMapSchema,
    ts: z.number(),
  }),
  z.object({
    k: z.literal('mst'),
    e: z.number(),
    m: z.number(),
    st: marketStatusSchema,
    ts: z.number(),
  }),
  z.object({
    k: z.literal('est'),
    e: z.number(),
    st: eventStatusSchema,
    sc: scoreSchema.optional(),
    ts: z.number(),
  }),
  z.object({ k: z.literal('add'), event: sportEventSchema, ts: z.number() }),
  z.object({ k: z.literal('rm'), e: z.number(), ts: z.number() }),
]);

export const feedMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('feed:snapshot'),
    seq: z.number().int(),
    events: z.array(sportEventSchema),
  }),
  z.object({
    t: z.literal('feed:batch'),
    seq: z.number().int(),
    ts: z.number(),
    changes: z.array(feedChangeSchema),
  }),
]);

export const placeBetRequestSchema = z
  .object({
    type: z.enum(['single', 'multiple']),
    stakeCents: z.number().int().min(1).max(MAX_STAKE_CENTS),
    acceptChanges: z.enum(['none', 'higher', 'any']),
    legs: z
      .array(
        z.object({
          eventId: z.number().int().positive(),
          marketId: z.number().int().positive(),
          sel: z.string().min(1).max(8),
          odds: oddsSchema,
        }),
      )
      .min(1)
      .max(MAX_LEGS),
  })
  .refine((req) => (req.type === 'single' ? req.legs.length === 1 : req.legs.length >= 2), {
    message: 'single needs exactly 1 leg, multiple needs 2 or more',
    path: ['legs'],
  });

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export type ClientMessageInput = z.infer<typeof clientMessageSchema>;
export type PlaceBetRequestInput = z.infer<typeof placeBetRequestSchema>;
