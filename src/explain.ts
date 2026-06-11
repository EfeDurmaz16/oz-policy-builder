/**
 * Assist layer: outlier flagging over the observed history.
 *
 * Deterministic IQR-based detection; transfers far above the typical amount
 * or to a never-before-seen destination late in the window get flagged so a
 * human (or an LLM summarising on top) can decide whether they belong in the
 * behaviour the policy is derived from. The LLM pass is intentionally a thin
 * optional layer above this; the base path stays model-free and reproducible.
 */
import type { ObservedTransfer } from './types.js';

export interface OutlierFlag {
  transfer: ObservedTransfer;
  reason: string;
}

function median(sortedAsc: bigint[]): bigint {
  const n = sortedAsc.length;
  if (n === 0) return 0n;
  return n % 2 === 1 ? sortedAsc[(n - 1) / 2]! : (sortedAsc[n / 2 - 1]! + sortedAsc[n / 2]!) / 2n;
}

/**
 * Flag transfers whose amount exceeds Q3 + 3*IQR (a conservative "far out"
 * fence), and transfers to a first-seen destination that are also above the
 * median amount (new counterparty + unusual size together).
 */
export function flagOutliers(transfers: ObservedTransfer[]): OutlierFlag[] {
  if (transfers.length < 4) return [];

  const amounts = transfers.map((t) => t.amountStroops).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const q1 = amounts[Math.floor(amounts.length / 4)]!;
  const q3 = amounts[Math.floor((3 * amounts.length) / 4)]!;
  const iqr = q3 - q1;
  const fence = q3 + 3n * iqr;
  const med = median(amounts);

  const ordered = [...transfers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const seen = new Set<string>();
  const flags: OutlierFlag[] = [];

  for (const t of ordered) {
    if (t.amountStroops > fence && iqr > 0n) {
      flags.push({ transfer: t, reason: `amount far above typical range (> Q3 + 3*IQR = ${fence} stroops)` });
    } else if (!seen.has(t.to) && seen.size > 0 && t.amountStroops > med) {
      flags.push({ transfer: t, reason: 'first transfer to a new destination, above the median amount' });
    }
    seen.add(t.to);
  }
  return flags;
}
