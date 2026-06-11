/**
 * Demo CLI: read a transfer history JSON, build a policy, simulate it, print
 * the OZ params + rationale. Run: `pnpm demo` or `tsx src/cli.ts <file.json>`.
 */
import { readFileSync } from 'node:fs';
import type { ObservedTransfer } from './types.js';
import { STROOPS_PER_XLM } from './types.js';
import { buildPolicy } from './propose.js';
import { simulate } from './simulate.js';

interface RawTransfer {
  at: string;
  amountStroops: string | number;
  to: string;
  asset: string;
}

function load(path: string): ObservedTransfer[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as RawTransfer[];
  return raw.map((r) => ({ at: r.at, amountStroops: BigInt(r.amountStroops), to: r.to, asset: r.asset }));
}

function xlm(stroops: bigint): string {
  return (Number(stroops) / Number(STROOPS_PER_XLM)).toFixed(4);
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: tsx src/cli.ts <transfers.json>');
    process.exit(1);
  }
  const transfers = load(path);
  const proposal = buildPolicy(transfers);

  console.log('\nOZ smart-account spending-limit policy (SpendingLimitAccountParams):');
  console.log(`  spending_limit: ${proposal.params.spending_limit} stroops (${xlm(proposal.params.spending_limit)} XLM)`);
  console.log(`  period_ledgers: ${proposal.params.period_ledgers}`);
  console.log('\nRationale:');
  for (const line of proposal.rationale) console.log(`  - ${line}`);

  const sim = simulate(transfers, proposal.params);
  console.log(`\nSimulation over observed history: ${sim.allowed} allowed, ${sim.blocked} blocked.`);
  if (sim.blocked > 0) {
    console.log('  (blocked transfers are window-cap breaches the policy would have stopped)');
  }
  console.log('');
}

main();
