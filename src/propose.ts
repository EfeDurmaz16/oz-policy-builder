/**
 * Propose stage: behaviour profile -> OZ spending-limit policy params.
 *
 * The inference mirrors the limit logic in the Sardis policy engine
 * (sardis-reference/src/policy): a rolling-window cap derived from observed
 * spend with a safety headroom, never below the largest legitimate transfer.
 * This is the deterministic core; an LLM-assisted layer (proposeWithLLM) can
 * wrap it to translate the rationale into natural language and flag outliers,
 * matching the RFP's "AI-assisted" framing without making the base path
 * depend on a model.
 */
import type { BehaviourProfile, PolicyProposal, ObservedTransfer } from './types.js';
import { LEDGERS_PER_DAY, STROOPS_PER_XLM } from './types.js';
import { profile } from './observe.js';

export interface ProposeOptions {
  /** Multiplier applied over observed window spend for headroom. Default 1.5. */
  headroom?: number;
  /** Rolling window length in days. Default: the observed window, min 1. */
  windowDays?: number;
}

function toXlm(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const frac = stroops % STROOPS_PER_XLM;
  return frac === 0n ? `${whole}` : `${whole}.${frac.toString().padStart(7, '0').replace(/0+$/, '')}`;
}

/** Round a stroop amount up to a clean 0.1-XLM boundary for a readable cap. */
function roundUpToTenthXlm(stroops: bigint): bigint {
  const step = STROOPS_PER_XLM / 10n;
  return ((stroops + step - 1n) / step) * step;
}

export function propose(prof: BehaviourProfile, opts: ProposeOptions = {}): PolicyProposal {
  const headroom = opts.headroom ?? 1.5;
  if (headroom < 1) throw new Error('headroom must be >= 1');

  const windowDays = opts.windowDays ?? Math.max(1, Math.round(prof.windowDays));
  const period_ledgers = windowDays * LEDGERS_PER_DAY;

  // Spend expected within one window at the observed rate.
  const perDayStroops = prof.totalStroops / BigInt(Math.max(1, Math.round(prof.windowDays)));
  const windowSpend = perDayStroops * BigInt(windowDays);

  // Apply headroom, but never cap below the largest single legitimate transfer
  // (otherwise a known-good payment would be blocked).
  const headroomScaled = (windowSpend * BigInt(Math.round(headroom * 100))) / 100n;
  const floor = prof.maxTransferStroops;
  const raw = headroomScaled > floor ? headroomScaled : floor;
  const spending_limit = roundUpToTenthXlm(raw);

  const rationale = [
    `Observed ${prof.count} transfers over ~${prof.windowDays.toFixed(1)} days across ${prof.distinctDestinations} destinations (${prof.assets.join(', ')}).`,
    `Per-window spend at the observed rate is ~${toXlm(windowSpend)} XLM over a ${windowDays}-day window.`,
    `Applied ${headroom}x headroom and floored at the largest single transfer (${toXlm(prof.maxTransferStroops)} XLM) to avoid blocking known-good payments.`,
    `Proposed cap: ${toXlm(spending_limit)} XLM per ${windowDays}-day window (${period_ledgers} ledgers).`,
  ];

  return { params: { spending_limit, period_ledgers }, rationale, profile: prof };
}

/** Convenience: observe + propose in one call. */
export function buildPolicy(transfers: ObservedTransfer[], opts: ProposeOptions = {}): PolicyProposal {
  return propose(profile(transfers), opts);
}
