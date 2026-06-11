# OZ Stellar Accounts Policy Builder

Generate [OpenZeppelin Stellar](https://github.com/OpenZeppelin/stellar-contracts) smart-account policies from observed or simulated account activity, instead of hand-writing limits.

Point it at an account's transfer history and it proposes a spending-limit policy (`SpendingLimitAccountParams`: a stroop cap over a rolling `period_ledgers` window), explains every number it chose, and simulates the policy against the history so you can see exactly what it would have allowed or blocked before you install it.

## Why

OZ's `packages/accounts` ships the policy primitives (`spending_limit`, threshold signers, context rules), but a developer still has to pick the numbers by hand and hope they match how the account actually behaves. This tool closes that gap: observed behaviour in, a defensible policy out, with a simulation that proves it does not block the legitimate traffic it was derived from.

## Pipeline

Three pure, deterministic stages:

1. **Observe** (`src/observe.ts`) — transfers in, a behaviour profile out (window length, total, p95 and max transfer, per-day rate, distinct destinations, assets). A live Horizon / Soroban-RPC fetcher feeding `ObservedTransfer[]` is a thin follow-up.
2. **Propose** (`src/propose.ts`) — profile to `SpendingLimitAccountParams`. A rolling-window cap from observed spend with a safety headroom, floored at the largest legitimate transfer so a known-good payment is never blocked. Emits a human-readable rationale for each chosen number.
3. **Simulate** (`src/simulate.ts`) — replay the transfers against the proposed policy using the same rolling-window eviction semantics as OZ `spending_limit.rs`, and report allowed vs blocked per transfer.

## Run it

```sh
npm install
npm test        # 9 tests: profiling, inference bounds, rolling-window simulation
npm run demo    # builds + simulates a policy from fixtures/payer-history.json
```

Demo output:

```
OZ smart-account spending-limit policy (SpendingLimitAccountParams):
  spending_limit: 132000000 stroops (13.2000 XLM)
  period_ledgers: 103680
...
Simulation over observed history: 8 allowed, 0 blocked.
```

## Lineage

The inference and simulation mirror the rolling-window limit logic in the Sardis policy engine (the open-source agent-spending decision engine, MIT), retargeted from card/agent spend to OZ Stellar smart-account policies. The emitted shape matches `SpendingLimitAccountParams` in OpenZeppelin/stellar-contracts.

## Roadmap

- Live `ObservedTransfer[]` fetcher from Horizon / Soroban RPC.
- LLM-assisted layer over `propose`: natural-language rationale and outlier flagging on top of the deterministic core (the base path stays model-free and reproducible).
- Emit and deploy the policy against a real OZ smart account, with an on-chain simulation test asserting the generated cap accepts the observed history and rejects an out-of-window drain.
- Threshold and weighted-signer policy inference, not just spending limits.

## License

MIT.
