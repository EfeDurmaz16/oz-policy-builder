/**
 * Observe stage: turn a set of transfers into a behaviour profile.
 *
 * Pure and deterministic, no IO. A Horizon/Soroban-RPC fetcher that produces
 * ObservedTransfer[] from a live account is a thin follow-up that feeds this.
 */
import type { ObservedTransfer, BehaviourProfile } from './types.js';

const MS_PER_DAY = 86_400_000;

/** Inclusive percentile on a sorted bigint array (nearest-rank). */
function percentile(sortedAsc: bigint[], p: number): bigint {
  if (sortedAsc.length === 0) return 0n;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const idx = Math.min(sortedAsc.length, Math.max(1, rank)) - 1;
  return sortedAsc[idx]!;
}

export function profile(transfers: ObservedTransfer[]): BehaviourProfile {
  if (transfers.length === 0) {
    throw new Error('cannot profile an empty transfer set');
  }

  const times = transfers.map((t) => Date.parse(t.at)).sort((a, b) => a - b);
  const spanMs = times[times.length - 1]! - times[0]!;
  // Guard the single-transfer / same-instant case: treat as a 1-day window.
  const windowDays = Math.max(1, spanMs / MS_PER_DAY);

  const amounts = transfers.map((t) => t.amountStroops).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const totalStroops = amounts.reduce((acc, a) => acc + a, 0n);

  return {
    count: transfers.length,
    windowDays,
    totalStroops,
    maxTransferStroops: amounts[amounts.length - 1]!,
    p95TransferStroops: percentile(amounts, 95),
    perDayMean: transfers.length / windowDays,
    distinctDestinations: new Set(transfers.map((t) => t.to)).size,
    assets: [...new Set(transfers.map((t) => t.asset))].sort(),
  };
}
