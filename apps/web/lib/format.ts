import { SPORTS } from '@liveline/protocol';

export const sportName = (id: number) => SPORTS.find((s) => s.id === id)?.name ?? `Sport ${id}`;

export const formatMoney = (cents: number) =>
  (cents / 100).toLocaleString('en-GB', { style: 'currency', currency: 'EUR' });

export function formatStart(start: number, now: number): string {
  const minutes = Math.round((start - now) / 60_000);
  if (minutes <= 0) return 'soon';
  if (minutes < 60) return `in ${minutes}m`;
  return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Short column label for a selection key. */
export function selectionLabel(type: string, k: string, line?: number): string {
  if (type === 'total') return `${k} ${line ?? ''}`.trim();
  if (type === 'handicap') return k === 'H' ? `1 ${line ?? ''}` : `2 +${Math.abs(line ?? 0)}`;
  return k;
}
