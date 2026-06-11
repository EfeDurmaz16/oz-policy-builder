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

## Proven on testnet

The full pipeline has been exercised against a real OZ smart account on Stellar testnet, with the policy installed using exactly the params this tool generated (0.6 XLM over 17280 ledgers). On-chain results, inclusive-boundary checked:

- transfer of 1,000,000 stroops: allowed ([a3d1ecc3](https://stellar.expert/explorer/testnet/tx/a3d1ecc31018e8eaa47511651c57effe8fd92318f23b5a7ea3c0219ceade1a9b))
- transfer pushing the window to 6.5M: rejected on-chain with `SpendingLimitExceeded` (#3221) ([da5d045b](https://stellar.expert/explorer/testnet/tx/da5d045bedd652f04c49360a9e72a0c7c9e4697ca9e4862db5aa3bbafbc5dd02))
- transfer landing exactly on the 6,000,000 cap: allowed, the limit is inclusive ([d6226404](https://stellar.expert/explorer/testnet/tx/d6226404d92154d9380de1cd9cd1862801253575e86223417460b729a9f8fc50))
- one stroop over the cap: rejected (#3221) ([f85d5faf](https://stellar.expert/explorer/testnet/tx/f85d5faf87c5063ddfafea661d271ba28879a7c93b94e51c8376c78591bf52d2))

The complete reproducible record (every command, contract ids, the `__check_auth` signing flow) is in [docs/testnet-proof/REPORT.md](docs/testnet-proof/REPORT.md), with the working ed25519 signing client at [docs/testnet-proof/sa.js](docs/testnet-proof/sa.js). The emit stage encodes the interface facts learned there: spending-limit policies require a `CallContract` context rule, the i128 install param rides as a string in CLI JSON, and installs need the smart account's own auth.

## Lineage

The inference and simulation mirror the rolling-window limit logic in the Sardis policy engine (the open-source agent-spending decision engine, MIT), retargeted from card/agent spend to OZ Stellar smart-account policies. The emitted shape matches `SpendingLimitAccountParams` in OpenZeppelin/stellar-contracts.

## Roadmap

- LLM-assisted layer over `propose`: natural-language policy explanation and anomaly triage on top of the deterministic core and the IQR outlier flags (the base path stays model-free and reproducible).
- Threshold and weighted-signer policy inference, not just spending limits.
- Context-rule suggestions (which token contracts to scope, signer sets) from the observed counterparty graph.
- One-command testnet installer wrapping the validated `add_context_rule` flow from docs/testnet-proof.

## License

MIT.
