/**
 * Simulate stage: replay transfers against a proposed policy.
 *
 * Mirrors the rolling-window semantics described in OZ stellar-contracts
 * spending_limit.rs: keep only the last `period_ledgers` of activity, sum the
 * window, and block any transfer that would push the window total over the
 * cap. Ledger time is modelled from timestamps at ~5s/ledger. This is the
 * offline "would the policy allow this?" check, the showcase for a proposal.
 */
import type { ObservedTransfer, SpendingLimitParams } from './types.js';
import { LEDGERS_PER_DAY } from './types.js';

const MS_PER_LEDGER = 5_000;

export interface SimDecision {
  at: string;
  amountStroops: bigint;
  allowed: boolean;
  windowTotalStroops: bigint;
}

export interface SimResult {
  decisions: SimDecision[];
  allowed: number;
  blocked: number;
}

/**
 * Replay transfers in chronological order. A transfer is allowed when the
 * rolling-window total (including it) stays at or below the cap.
 */
export function simulate(transfers: ObservedTransfer[], params: SpendingLimitParams): SimResult {
  const ordered = [...transfers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const windowMs = params.period_ledgers * MS_PER_LEDGER;

  const accepted: { atMs: number; amount: bigint }[] = [];
  const decisions: SimDecision[] = [];
  let allowed = 0;
  let blocked = 0;

  for (const t of ordered) {
    const atMs = Date.parse(t.at);
    const cutoff = atMs - windowMs;
    // Evict entries strictly older than the rolling window.
    while (accepted.length > 0 && accepted[0]!.atMs <= cutoff) accepted.shift();

    const windowSoFar = accepted.reduce((acc, e) => acc + e.amount, 0n);
    const windowTotal = windowSoFar + t.amountStroops;
    const ok = windowTotal <= params.spending_limit;

    if (ok) {
      accepted.push({ atMs, amount: t.amountStroops });
      allowed++;
    } else {
      blocked++;
    }
    decisions.push({ at: t.at, amountStroops: t.amountStroops, allowed: ok, windowTotalStroops: windowTotal });
  }

  return { decisions, allowed, blocked };
}

export { LEDGERS_PER_DAY };
