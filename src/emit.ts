/**
 * Emit stage: turn a PolicyProposal into install-ready artifacts.
 *
 * The interface below was validated against a real deploy on Stellar testnet
 * (see docs/testnet-proof/REPORT.md). Key facts the artifacts encode:
 *
 * - A spending-limit policy can only live on a `ContextRuleType::CallContract`
 *   rule (install panics with #3227 OnlyCallContractAllowed on `Default`
 *   rules), so the TOKEN contract address is a required input next to the
 *   generated `{spending_limit, period_ledgers}`.
 * - The install param is an ScVal map; in CLI JSON the i128 `spending_limit`
 *   must be a string: `{"period_ledgers":17280,"spending_limit":"6000000"}`.
 * - `add_context_rule` / `add_policy` require the smart account's own auth
 *   (`__check_auth` with the account's custom AuthPayload), which a plain
 *   `--source-account` invoke cannot provide; the sketch flags this.
 */
import type { PolicyProposal } from './types.js';

export interface EmitOptions {
  /** Token (SAC) contract id the spending limit applies to. */
  tokenContract?: string;
  /** Deployed spending-limit policy contract id. */
  policyContract?: string;
}

export interface EmittedArtifacts {
  /** CLI-JSON install param (i128 as string), matching the validated encoding. */
  paramsJson: string;
  /** Rust struct literal for SpendingLimitAccountParams. */
  rustLiteral: string;
  /** stellar-cli sketch for installing the policy on a smart account. */
  installSketch: string;
}

export function emit(proposal: PolicyProposal, opts: EmitOptions = {}): EmittedArtifacts {
  const { spending_limit, period_ledgers } = proposal.params;
  const token = opts.tokenContract ?? '$TOKEN';
  const policy = opts.policyContract ?? '$POLICY';

  const paramsJson = JSON.stringify(
    { period_ledgers, spending_limit: spending_limit.toString() },
    null,
    2,
  );

  const rustLiteral = [
    'SpendingLimitAccountParams {',
    `    spending_limit: ${spending_limit}, // stroops`,
    `    period_ledgers: ${period_ledgers},`,
    '}',
  ].join('\n');

  const installSketch = [
    '# Install the generated spending-limit policy on an OZ smart account.',
    '# The rule MUST be CallContract(token): spending_limit rejects Default rules (#3227).',
    '# NOTE: add_context_rule requires the smart account’s own auth (__check_auth',
    '# with its AuthPayload); build with --build-only and sign with an account',
    '# signer, a plain --source-account invoke cannot authorize this call.',
    'stellar contract invoke --id "$SMART_ACCOUNT" -- add_context_rule \\',
    `  --context_type '{"CallContract":"${token}"}' \\`,
    `  --name '"spend_limit"' --valid_until null \\`,
    `  --signers '[{"External":["$VERIFIER","$PUBKEY_HEX"]}]' \\`,
    `  --policies '{"${policy}":{"period_ledgers":${period_ledgers},"spending_limit":"${spending_limit}"}}'`,
    '',
    '# Or attach to an existing context rule:',
    'stellar contract invoke --id "$SMART_ACCOUNT" -- add_policy \\',
    `  --context_rule_id "$RULE_ID" --policy "${policy}" \\`,
    `  --install_param '{"period_ledgers":${period_ledgers},"spending_limit":"${spending_limit}"}'`,
  ].join('\n');

  return { paramsJson, rustLiteral, installSketch };
}
