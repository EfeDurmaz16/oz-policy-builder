/**
 * Emit stage: turn a PolicyProposal into install-ready artifacts.
 *
 * Produces (1) a JSON params file matching `SpendingLimitAccountParams` in
 * OZ stellar-contracts, (2) the Rust struct literal for embedding in a
 * deploy script or test, and (3) a stellar-cli invocation sketch with the
 * contract ids left as placeholders to fill at deploy time.
 */
import type { PolicyProposal } from './types.js';

export interface EmittedArtifacts {
  /** JSON-serialisable params, field names matching the OZ contract type. */
  paramsJson: string;
  /** Rust struct literal for SpendingLimitAccountParams. */
  rustLiteral: string;
  /** stellar-cli sketch for installing the policy on a smart account. */
  installSketch: string;
}

export function emit(proposal: PolicyProposal): EmittedArtifacts {
  const { spending_limit, period_ledgers } = proposal.params;

  const paramsJson = JSON.stringify(
    { spending_limit: spending_limit.toString(), period_ledgers },
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
    '# Fill SMART_ACCOUNT and POLICY (deployed contract ids) before running.',
    'stellar contract invoke \\',
    '  --network testnet --source-account deployer \\',
    '  --id "$SMART_ACCOUNT" \\',
    '  -- add_policy \\',
    '  --policy "$POLICY" \\',
    `  --install-param '{"spending_limit": "${spending_limit}", "period_ledgers": ${period_ledgers}}'`,
  ].join('\n');

  return { paramsJson, rustLiteral, installSketch };
}
