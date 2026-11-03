import Database from 'better-sqlite3';
import type { Bet } from '@liveline/protocol';

export const START_BALANCE_CENTS = 100_000;

export interface StoredResponse {
  requestHash: string;
  statusCode: number;
  body: unknown;
}

/** SQLite storage: accounts (mock balance), bets and idempotency records. */
export class BetRepository {
  readonly db: Database.Database;

  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        user_id       TEXT PRIMARY KEY,
        balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0)
      );
      CREATE TABLE IF NOT EXISTS bets (
        id                     TEXT PRIMARY KEY,
        user_id                TEXT NOT NULL,
        type                   TEXT NOT NULL,
        stake_cents            INTEGER NOT NULL,
        total_odds             REAL NOT NULL,
        potential_return_cents INTEGER NOT NULL,
        legs_json              TEXT NOT NULL,
        placed_at              TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS bets_user ON bets (user_id, placed_at DESC);
      CREATE TABLE IF NOT EXISTS idempotency (
        user_id       TEXT NOT NULL,
        key           TEXT NOT NULL,
        request_hash  TEXT NOT NULL,
        status_code   INTEGER NOT NULL,
        response_json TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );
    `);
  }

  balance(userId: string): number {
    this.db
      .prepare('INSERT OR IGNORE INTO accounts (user_id, balance_cents) VALUES (?, ?)')
      .run(userId, START_BALANCE_CENTS);
    const row = this.db
      .prepare('SELECT balance_cents FROM accounts WHERE user_id = ?')
      .get(userId) as {
      balance_cents: number;
    };
    return row.balance_cents;
  }

  resetBalance(userId: string): number {
    this.db
      .prepare(
        'INSERT INTO accounts (user_id, balance_cents) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET balance_cents = excluded.balance_cents',
      )
      .run(userId, START_BALANCE_CENTS);
    return START_BALANCE_CENTS;
  }

  findResponse(userId: string, key: string): StoredResponse | undefined {
    const row = this.db
      .prepare(
        'SELECT request_hash, status_code, response_json FROM idempotency WHERE user_id = ? AND key = ?',
      )
      .get(userId, key) as
      { request_hash: string; status_code: number; response_json: string } | undefined;
    return (
      row && {
        requestHash: row.request_hash,
        statusCode: row.status_code,
        body: JSON.parse(row.response_json),
      }
    );
  }

  saveResponse(userId: string, key: string, response: StoredResponse): void {
    this.db
      .prepare(
        'INSERT INTO idempotency (user_id, key, request_hash, status_code, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        userId,
        key,
        response.requestHash,
        response.statusCode,
        JSON.stringify(response.body),
        new Date().toISOString(),
      );
  }

  /** Debits the stake and stores the bet. Returns the new balance. Call inside `transaction`. */
  insertBet(userId: string, bet: Bet): number {
    const debit = this.db
      .prepare(
        'UPDATE accounts SET balance_cents = balance_cents - ? WHERE user_id = ? AND balance_cents >= ?',
      )
      .run(bet.stakeCents, userId, bet.stakeCents);
    if (debit.changes !== 1) throw new Error('insufficient balance');
    this.db
      .prepare(
        'INSERT INTO bets (id, user_id, type, stake_cents, total_odds, potential_return_cents, legs_json, placed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        bet.id,
        userId,
        bet.type,
        bet.stakeCents,
        bet.totalOdds,
        bet.potentialReturnCents,
        JSON.stringify(bet.legs),
        bet.placedAt,
      );
    return this.balance(userId);
  }

  recentBets(userId: string, limit = 20): Bet[] {
    const rows = this.db
      .prepare(
        'SELECT id, type, stake_cents, total_odds, potential_return_cents, legs_json, placed_at FROM bets WHERE user_id = ? ORDER BY placed_at DESC LIMIT ?',
      )
      .all(userId, limit) as {
      id: string;
      type: Bet['type'];
      stake_cents: number;
      total_odds: number;
      potential_return_cents: number;
      legs_json: string;
      placed_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      stakeCents: r.stake_cents,
      totalOdds: r.total_odds,
      potentialReturnCents: r.potential_return_cents,
      legs: JSON.parse(r.legs_json) as Bet['legs'],
      placedAt: r.placed_at,
    }));
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  close(): void {
    this.db.close();
  }
}
