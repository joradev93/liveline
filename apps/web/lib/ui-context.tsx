'use client';

import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { BetslipStore } from './betslip';

export const BetslipContext = createContext<BetslipStore | null>(null);
/** Opens the event details panel. Stable function, so rows do not re-render when it is used. */
export const SelectEventContext = createContext<(eventId: number | null) => void>(() => {});

export function useBetslip(): BetslipStore {
  const slip = useContext(BetslipContext);
  if (!slip) throw new Error('BetslipContext missing');
  return slip;
}

export function useIsSelected(marketId: number, k: string): boolean {
  const slip = useBetslip();
  const get = useCallback(() => slip.has(marketId, k), [slip, marketId, k]);
  return useSyncExternalStore(slip.subscribe, get, get);
}

export function useSlipLegs() {
  const slip = useBetslip();
  return useSyncExternalStore(slip.subscribe, slip.getLegs, slip.getLegs);
}

export function useSlipPolicy() {
  const slip = useBetslip();
  return useSyncExternalStore(slip.subscribe, slip.getPolicy, slip.getPolicy);
}

export const useSelectEvent = () => useContext(SelectEventContext);
