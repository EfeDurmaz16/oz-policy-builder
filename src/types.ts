/**
 * Domain types for the OZ Stellar Accounts Policy Builder.
 *
 * The observed-transaction and behaviour-profile types are local. The emitted
 * policy shape mirrors `SpendingLimitAccountParams` in
 * OpenZeppelin/stellar-contracts (packages/accounts/src/policies/spending_limit.rs):
 * a stroop-denominated `spending_limit` over a rolling `period_ledgers` window.
 */

/** A single observed transfer out of the account, normalised. */
export interface ObservedTransfer {
  /** ISO-8601 timestamp of the transaction. */
  at: string;
  /** Transfer amount in stroops (1 XLM = 10_000_000 stroops). */
  amountStroops: bigint;
  /** Destination account (Stellar address or contract id). */
  to: string;
  /** Asset code; "XLM" for native. */
  asset: string;
}

/** Behaviour profile distilled from the observed transfers. */
export interface BehaviourProfile {
  count: number;
  windowDays: number;
  totalStroops: bigint;
  maxTransferStroops: bigint;
  /** 95th-percentile single transfer, the basis for the per-window cap. */
  p95TransferStroops: bigint;
  /** Mean transfers per day over the observed window. */
  perDayMean: number;
  distinctDestinations: number;
  assets: string[];
}

/**
 * Proposed OZ smart-account spending-limit policy.
 * Field names match SpendingLimitAccountParams in OZ stellar-contracts.
 */
export interface SpendingLimitParams {
  /** Cap per rolling window, in stroops. */
  spending_limit: bigint;
  /** Rolling window length in ledgers (~5s per ledger on Stellar). */
  period_ledgers: number;
}

export interface PolicyProposal {
  params: SpendingLimitParams;
  /** Human-readable justification for each chosen number. */
  rationale: string[];
  profile: BehaviourProfile;
}

/** ~5 seconds per ledger on Stellar mainnet. */
export const LEDGERS_PER_DAY = 17_280;
export const STROOPS_PER_XLM = 10_000_000n;
