/**
 * Live fetcher: pull an account's outgoing payments from Horizon and
 * normalise them into ObservedTransfer[] for the observe stage.
 *
 * Read-only against the public Horizon API. Only native-XLM and credit-asset
 * `payment` operations where the account is the sender are kept; path
 * payments and non-payment ops are out of scope for the spending profile.
 */
import type { ObservedTransfer } from './types.js';
import { STROOPS_PER_XLM } from './types.js';

const DEFAULT_HORIZON = 'https://horizon.stellar.org';

interface HorizonPaymentRecord {
  type: string;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  created_at: string;
}

interface HorizonPage {
  _embedded: { records: HorizonPaymentRecord[] };
}

/** Convert Horizon's decimal-string amount (7dp) into stroops. */
export function amountToStroops(amount: string): bigint {
  const [whole = '0', frac = ''] = amount.split('.');
  const fracPadded = (frac + '0000000').slice(0, 7);
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(fracPadded);
}

export interface FetchOptions {
  horizonUrl?: string;
  /** Max payment records to scan (paged 200 at a time). Default 200. */
  limit?: number;
}

export async function fetchOutgoingTransfers(
  account: string,
  opts: FetchOptions = {},
): Promise<ObservedTransfer[]> {
  const base = (opts.horizonUrl ?? DEFAULT_HORIZON).replace(/\/$/, '');
  const limit = Math.min(opts.limit ?? 200, 200);
  const url = `${base}/accounts/${encodeURIComponent(account)}/payments?order=desc&limit=${limit}`;

  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Horizon ${res.status} for ${account}: ${await res.text().then((t) => t.slice(0, 200))}`);
  }
  const page = (await res.json()) as HorizonPage;

  const transfers: ObservedTransfer[] = [];
  for (const r of page._embedded.records) {
    if (r.type !== 'payment') continue;
    if (r.from !== account) continue; // outgoing only
    if (!r.amount || !r.to) continue;
    transfers.push({
      at: r.created_at,
      amountStroops: amountToStroops(r.amount),
      to: r.to,
      asset: r.asset_type === 'native' ? 'XLM' : (r.asset_code ?? r.asset_type ?? 'unknown'),
    });
  }
  return transfers.reverse(); // chronological
}
