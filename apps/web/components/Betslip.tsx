'use client';

import {
  combineOdds,
  eventTopic,
  formatOdds,
  oddsToInt,
  type AcceptChanges,
  type Bet,
  type PlaceBetRequest,
  type PlaceBetResponse,
} from '@liveline/protocol';
import { useEffect, useMemo, useState } from 'react';
import { fetchBalance, placeBet, resetBalance } from '@/lib/bet-client';
import { legKey, type SlipLeg } from '@/lib/betslip';
import { formatMoney } from '@/lib/format';
import { useEvent, useFeed, useMarketStatus, usePrices } from '@/lib/hooks';
import { useBetslip, useSlipLegs, useSlipPolicy } from '@/lib/ui-context';

type Mode = 'singles' | 'multiple';
type Notice = { kind: 'ok' | 'error' | 'warn'; text: string };

const POLICIES: { value: AcceptChanges; label: string; hint: string }[] = [
  { value: 'none', label: 'None', hint: 'Reject the bet if any price changed' },
  { value: 'higher', label: 'Higher', hint: 'Accept price increases only' },
  { value: 'any', label: 'Any', hint: 'Accept any price change' },
];

const parseStake = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);

export function Betslip() {
  const slip = useBetslip();
  const legs = useSlipLegs();
  const policy = useSlipPolicy();
  const prices = usePrices(legs);
  const feed = useFeed();
  const [mode, setMode] = useState<Mode>('singles');
  const [stakes, setStakes] = useState<Record<string, string>>({});
  const [multiStake, setMultiStake] = useState('10');
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [receipts, setReceipts] = useState<Bet[]>([]);

  useEffect(() => {
    void fetchBalance().then(setBalance);
  }, []);

  // Keep prices of betslip legs live even when their sport is not on screen.
  useEffect(() => {
    if (!feed) return;
    const offs = [...new Set(legs.map((l) => l.eventId))].map((id) =>
      feed.subscribe(eventTopic(id)),
    );
    return () => offs.forEach((off) => off());
  }, [feed, legs]);

  const distinctEvents = new Set(legs.map((l) => l.eventId)).size === legs.length;
  const canMultiple = legs.length >= 2 && distinctEvents;
  const activeMode: Mode = mode === 'multiple' && canMultiple ? 'multiple' : 'singles';

  const changed = legs.some(
    (l, i) => prices[i] !== undefined && oddsToInt(prices[i]!) !== oddsToInt(l.odds),
  );
  const shortened = legs.some(
    (l, i) => prices[i] !== undefined && oddsToInt(prices[i]!) < oddsToInt(l.odds),
  );
  const needsAccept = changed && (policy === 'none' || (policy === 'higher' && shortened));
  const multipleOdds = useMemo(() => combineOdds(legs.map((l) => l.odds)), [legs]);

  const stakeOf = (leg: SlipLeg) => stakes[legKey(leg.marketId, leg.k)] ?? '10';
  const totalStake =
    activeMode === 'multiple'
      ? parseStake(multiStake)
      : legs.reduce((sum, l) => sum + parseStake(stakeOf(l)), 0);
  const invalidStake = !Number.isFinite(totalStake) || totalStake <= 0;

  const acceptChanges = () => {
    slip.acceptOdds(new Map(legs.map((l, i) => [legKey(l.marketId, l.k), prices[i] ?? l.odds])));
    setNotice(null);
  };

  const requestsFor = (): { legs: SlipLeg[]; request: PlaceBetRequest }[] => {
    const toLeg = (l: SlipLeg) => ({
      eventId: l.eventId,
      marketId: l.marketId,
      sel: l.k,
      odds: l.odds,
    });
    if (activeMode === 'multiple') {
      return [
        {
          legs,
          request: {
            type: 'multiple',
            stakeCents: parseStake(multiStake),
            acceptChanges: policy,
            legs: legs.map(toLeg),
          },
        },
      ];
    }
    return legs.map((l) => ({
      legs: [l],
      request: {
        type: 'single',
        stakeCents: parseStake(stakeOf(l)),
        acceptChanges: policy,
        legs: [toLeg(l)],
      },
    }));
  };

  const submit = async () => {
    setBusy(true);
    setNotice(null);
    const placed: Bet[] = [];
    const problems: string[] = [];
    let latestBalance: number | null = null;
    for (const { legs: betLegs, request } of requestsFor()) {
      let response: PlaceBetResponse;
      try {
        response = await placeBet(request, crypto.randomUUID());
      } catch {
        problems.push('Network error: bet service not reachable');
        break;
      }
      if (response.status === 'accepted') {
        placed.push(response.bet);
        latestBalance = response.balanceCents;
        for (const l of betLegs) slip.remove(l.marketId, l.k);
      } else {
        problems.push(rejectText(response.code, response.message));
      }
    }
    if (latestBalance !== null) setBalance(latestBalance);
    if (placed.length) setReceipts((r) => [...placed, ...r].slice(0, 5));
    setNotice(
      problems.length
        ? { kind: placed.length ? 'warn' : 'error', text: problems.join(' · ') }
        : { kind: 'ok', text: placed.length === 1 ? 'Bet placed' : `${placed.length} bets placed` },
    );
    setBusy(false);
  };

  return (
    <section className="card betslip" aria-label="Betslip">
      <header className="card-head">
        <span>
          Betslip <span className="count">{legs.length}</span>
        </span>
        <span className="balance" title="Mock balance">
          {balance === null ? '—' : formatMoney(balance)}
          <button
            type="button"
            className="link"
            onClick={() => void resetBalance().then(setBalance)}
          >
            reset
          </button>
        </span>
      </header>

      {legs.length === 0 ? (
        <div className="card-body muted">Click any price to add it here.</div>
      ) : (
        <div className="card-body">
          <div className="segmented" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'singles'}
              onClick={() => setMode('singles')}
            >
              Singles
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'multiple'}
              disabled={!canMultiple}
              title={canMultiple ? '' : 'Needs 2+ selections from different events'}
              onClick={() => setMode('multiple')}
            >
              Multiple
            </button>
          </div>

          <ul className="legs">
            {legs.map((leg, i) => (
              <LegRow
                key={legKey(leg.marketId, leg.k)}
                leg={leg}
                current={prices[i]}
                stake={activeMode === 'singles' ? stakeOf(leg) : null}
                onStake={(value) =>
                  setStakes((s) => ({ ...s, [legKey(leg.marketId, leg.k)]: value }))
                }
                onRemove={() => slip.remove(leg.marketId, leg.k)}
              />
            ))}
          </ul>

          {activeMode === 'multiple' && (
            <div className="multi">
              <span>
                {legs.length}-fold at <strong>{formatOdds(multipleOdds)}</strong>
              </span>
              <StakeInput value={multiStake} onChange={setMultiStake} />
            </div>
          )}

          <div className="policy">
            <span className="muted">Odds changes</span>
            <div className="segmented small">
              {POLICIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={policy === p.value}
                  title={p.hint}
                  onClick={() => slip.setPolicy(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="totals">
            <span className="muted">Total stake</span>
            <span>{invalidStake ? '—' : formatMoney(totalStake)}</span>
            <span className="muted">Potential return</span>
            <span>
              {invalidStake
                ? '—'
                : formatMoney(
                    activeMode === 'multiple'
                      ? Math.round(totalStake * multipleOdds)
                      : legs.reduce(
                          (sum, l) => sum + Math.round(parseStake(stakeOf(l)) * l.odds),
                          0,
                        ),
                  )}
            </span>
          </div>

          {needsAccept ? (
            <button type="button" className="primary warn" onClick={acceptChanges}>
              Accept odds changes
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy || invalidStake}
              onClick={() => void submit()}
            >
              {busy
                ? 'Placing…'
                : activeMode === 'multiple'
                  ? 'Place multiple'
                  : `Place ${legs.length > 1 ? `${legs.length} bets` : 'bet'}`}
            </button>
          )}
        </div>
      )}

      {notice && (
        <div className="notice" data-kind={notice.kind} role="status">
          {notice.text}
        </div>
      )}
      {receipts.length > 0 && (
        <ul className="receipts">
          {receipts.map((bet) => (
            <li key={bet.id}>
              <span>
                {bet.type === 'multiple' ? `${bet.legs.length}-fold` : 'Single'} @{' '}
                {formatOdds(bet.totalOdds)}
              </span>
              <span className="muted">
                {formatMoney(bet.stakeCents)} → {formatMoney(bet.potentialReturnCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LegRow({
  leg,
  current,
  stake,
  onStake,
  onRemove,
}: {
  leg: SlipLeg;
  current: number | undefined;
  stake: string | null;
  onStake: (value: string) => void;
  onRemove: () => void;
}) {
  const status = useMarketStatus(leg.marketId);
  const event = useEvent(leg.eventId);
  const closed = !event || event.status === 'settled';
  const warning = closed
    ? 'Event closed'
    : event.status === 'suspended'
      ? 'Event suspended'
      : status !== 'open'
        ? `Market ${status}`
        : null;
  const moved = current !== undefined && oddsToInt(current) !== oddsToInt(leg.odds);
  const direction = moved ? (current! > leg.odds ? 'up' : 'down') : undefined;
  return (
    <li className="leg">
      <div className="leg-main">
        <div className="leg-pick">{leg.label}</div>
        <div className="leg-meta">
          {leg.marketName} · {leg.eventName}
        </div>
        {warning && <div className="leg-warn">{warning}</div>}
      </div>
      <div className="leg-odds" data-dir={direction}>
        {moved && <s className="muted">{formatOdds(leg.odds)}</s>}
        <strong>{formatOdds(current ?? leg.odds)}</strong>
      </div>
      {stake !== null && <StakeInput value={stake} onChange={onStake} />}
      <button
        type="button"
        className="icon-btn small"
        onClick={onRemove}
        aria-label={`Remove ${leg.label}`}
      >
        ×
      </button>
    </li>
  );
}

function StakeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="stake">
      <span>€</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Stake"
      />
    </label>
  );
}

function rejectText(code: string, message: string): string {
  switch (code) {
    case 'ODDS_CHANGED':
      return 'Odds changed — review and accept the new prices';
    case 'MARKET_SUSPENDED':
      return 'Market suspended — try again in a moment';
    case 'EVENT_CLOSED':
      return 'Event closed for betting';
    case 'INSUFFICIENT_BALANCE':
      return 'Not enough balance';
    default:
      return message;
  }
}
