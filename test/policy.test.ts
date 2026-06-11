import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profile } from '../src/observe.ts';
import { propose, buildPolicy } from '../src/propose.ts';
import { simulate } from '../src/simulate.ts';
import type { ObservedTransfer } from '../src/types.ts';
import { LEDGERS_PER_DAY, STROOPS_PER_XLM } from '../src/types.ts';

const xlm = (n: number): bigint => BigInt(n) * STROOPS_PER_XLM;

const week: ObservedTransfer[] = [
  { at: '2026-05-01T09:00:00Z', amountStroops: xlm(1), to: 'A', asset: 'XLM' },
  { at: '2026-05-02T09:00:00Z', amountStroops: xlm(2), to: 'B', asset: 'XLM' },
  { at: '2026-05-03T09:00:00Z', amountStroops: xlm(1), to: 'A', asset: 'XLM' },
  { at: '2026-05-04T09:00:00Z', amountStroops: xlm(3), to: 'C', asset: 'XLM' },
  { at: '2026-05-05T09:00:00Z', amountStroops: xlm(1), to: 'B', asset: 'XLM' },
];

test('profile distils count, window, max and destinations', () => {
  const p = profile(week);
  assert.equal(p.count, 5);
  assert.equal(p.distinctDestinations, 3);
  assert.equal(p.maxTransferStroops, xlm(3));
  assert.equal(p.totalStroops, xlm(8));
  assert.ok(p.windowDays >= 4 && p.windowDays <= 5);
  assert.deepEqual(p.assets, ['XLM']);
});

test('single transfer profiles as a 1-day window without dividing by zero', () => {
  const one: ObservedTransfer[] = [{ at: '2026-05-01T09:00:00Z', amountStroops: xlm(5), to: 'A', asset: 'XLM' }];
  const p = profile(one);
  assert.equal(p.windowDays, 1);
  assert.equal(p.perDayMean, 1);
  assert.equal(p.maxTransferStroops, xlm(5));
});

test('empty transfer set throws rather than producing a bogus policy', () => {
  assert.throws(() => profile([]), /empty/);
});

test('proposed cap is never below the largest single transfer', () => {
  // Tiny headroom would otherwise cap below the 3 XLM transfer.
  const proposal = propose(profile(week), { headroom: 1 });
  assert.ok(proposal.params.spending_limit >= xlm(3), 'cap must clear the largest legit transfer');
});

test('period_ledgers reflects the requested window in days', () => {
  const proposal = propose(profile(week), { windowDays: 7 });
  assert.equal(proposal.params.period_ledgers, 7 * LEDGERS_PER_DAY);
});

test('headroom below 1 is rejected', () => {
  assert.throws(() => propose(profile(week), { headroom: 0.5 }), /headroom/);
});

test('observed history passes its own generated policy (no false blocks on a 1-day window)', () => {
  // A generous per-day window means each day clears; the point is the policy
  // does not block the legitimate history it was built from.
  const proposal = buildPolicy(week, { windowDays: 1, headroom: 3 });
  const sim = simulate(week, proposal.params);
  assert.equal(sim.blocked, 0, 'a policy must not block the behaviour it was trained on');
  assert.equal(sim.allowed, week.length);
});

test('simulate blocks a burst that breaches the rolling window', () => {
  const proposal = buildPolicy(week, { windowDays: 7, headroom: 1.2 });
  // An attacker drains far above the weekly cap in one shot.
  const attack: ObservedTransfer[] = [
    ...week,
    { at: '2026-05-06T09:00:00Z', amountStroops: xlm(1000), to: 'EVIL', asset: 'XLM' },
  ];
  const sim = simulate(attack, proposal.params);
  assert.equal(sim.blocked, 1, 'the 1000 XLM drain must be blocked');
  const last = sim.decisions.at(-1)!;
  assert.equal(last.allowed, false);
});

test('rolling window evicts old spend so a later transfer is allowed again', () => {
  const params = { spending_limit: xlm(10), period_ledgers: LEDGERS_PER_DAY }; // 10 XLM / day
  const txs: ObservedTransfer[] = [
    { at: '2026-05-01T09:00:00Z', amountStroops: xlm(9), to: 'A', asset: 'XLM' },
    // same day: 9 + 5 = 14 > 10 -> blocked
    { at: '2026-05-01T20:00:00Z', amountStroops: xlm(5), to: 'B', asset: 'XLM' },
    // 2 days later: window cleared -> allowed
    { at: '2026-05-03T09:00:00Z', amountStroops: xlm(9), to: 'C', asset: 'XLM' },
  ];
  const sim = simulate(txs, params);
  assert.deepEqual(
    sim.decisions.map((d) => d.allowed),
    [true, false, true],
  );
});

test('flagOutliers catches a drain-sized transfer the history never had', async () => {
  const { flagOutliers } = await import('../src/explain.ts');
  const txs: ObservedTransfer[] = [
    { at: '2026-05-01T09:00:00Z', amountStroops: xlm(1), to: 'A', asset: 'XLM' },
    { at: '2026-05-02T09:00:00Z', amountStroops: xlm(1), to: 'A', asset: 'XLM' },
    { at: '2026-05-03T09:00:00Z', amountStroops: xlm(2), to: 'B', asset: 'XLM' },
    { at: '2026-05-04T09:00:00Z', amountStroops: xlm(1), to: 'B', asset: 'XLM' },
    { at: '2026-05-05T09:00:00Z', amountStroops: xlm(500), to: 'EVIL', asset: 'XLM' },
  ];
  const flags = flagOutliers(txs);
  assert.ok(flags.length >= 1);
  assert.equal(flags.at(-1)!.transfer.to, 'EVIL');
});

test('flagOutliers stays quiet on uniform history', async () => {
  const { flagOutliers } = await import('../src/explain.ts');
  const flags = flagOutliers(week);
  assert.equal(flags.filter((f) => f.reason.includes('far above')).length, 0);
});

test('emit produces OZ-shaped params in all three artifact forms', async () => {
  const { emit } = await import('../src/emit.ts');
  const proposal = buildPolicy(week, { windowDays: 1, headroom: 3 });
  const art = emit(proposal);
  const parsed = JSON.parse(art.paramsJson);
  assert.equal(parsed.period_ledgers, LEDGERS_PER_DAY);
  assert.equal(BigInt(parsed.spending_limit), proposal.params.spending_limit);
  assert.match(art.rustLiteral, /SpendingLimitAccountParams \{/);
  assert.match(art.installSketch, /add_context_rule/);
  assert.match(art.installSketch, /CallContract/);
  assert.match(art.installSketch, /--install_param/);
  // i128 spending_limit must be a string in CLI JSON (validated on testnet).
  assert.match(art.paramsJson, /"spending_limit": "/);
});
