# Technical Architecture — OZ Accounts Policy Builder (Stellar / Soroban)

This document describes the architecture and the Stellar integration of the OZ Accounts Policy Builder. It is Stellar-specific by design: every stage targets the OpenZeppelin Stellar smart-account contracts (`OpenZeppelin/stellar-contracts`, `packages/accounts`) and the Stellar account model on Soroban.

## Problem

OZ `packages/accounts` ships the on-chain policy primitives for Soroban smart accounts (`spending_limit`, simple/weighted threshold signers, context rules). A developer still has to choose the policy parameters by hand and hope they match how the account actually behaves. Too tight and legitimate payments are rejected on-chain; too loose and the policy provides no protection. There is no tool that derives a defensible policy from real account activity and proves it on-chain before installation.

## Pipeline

Four deterministic stages, plus an optional AI-assist layer.

1. **Observe** (`src/observe.ts`, `src/fetch.ts`)
   Pull an account's outgoing transfers from **Stellar Horizon** (`/accounts/{account}/payments`) or Soroban RPC and distil a behaviour profile: rolling window, total, p95 and max transfer, per-day rate, distinct destinations, assets. Only outgoing `payment` operations are kept; amounts are normalised to stroops.

2. **Propose** (`src/propose.ts`)
   Infer `SpendingLimitAccountParams { spending_limit (stroops), period_ledgers }` — the exact install-time type of the OZ Stellar `spending_limit` policy contract. The cap is derived from observed spend with a safety headroom and floored at the largest legitimate transfer, with a written rationale for every chosen number. `period_ledgers` is computed at Stellar's ~5s/ledger cadence.

3. **Simulate** (`src/simulate.ts`)
   Replay the account history against the proposed policy using the **same rolling-window eviction semantics as OZ `packages/accounts/src/policies/spending_limit.rs`** (entries older than `current_ledger - period_ledgers` evicted before each evaluation), reporting allowed vs blocked per transfer. This proves the policy does not block the legitimate traffic it was derived from, before anything is installed.

4. **Emit + install** (`src/emit.ts`)
   Produce install-ready artifacts and drive the real OZ smart-account flow. The interface was validated on Stellar testnet:
   - The policy must live on a `ContextRuleType::CallContract(token)` context rule (a `Default` rule panics with `#3227 OnlyCallContractAllowed`), so the SAC token contract address is a required input alongside the generated params.
   - Install via `add_context_rule(context_type, name, valid_until, signers, policies)` or `add_policy(context_rule_id, policy, install_param)`; the i128 `spending_limit` rides as a string in the CLI/JSON install param.
   - The smart account's own `__check_auth` (custom `AuthPayload { signers, context_rule_ids }`, ed25519 signers signing `sha256(signature_payload || xdr(ScVal::Vec[U32(rule_id)...]))`) authorizes the install; a plain source-account invoke cannot.

## Stellar integration surface

| Layer | Stellar component |
|---|---|
| Account data | Horizon `/accounts/{id}/payments`, Soroban RPC |
| Policy target | `OpenZeppelin/stellar-contracts` `packages/accounts` (`spending_limit`, threshold/weighted signers, context rules) |
| Smart-account auth | Soroban custom-account `__check_auth`, ed25519 verifier contract |
| Token | Stellar Asset Contract (SAC), stroop-denominated amounts |
| Tooling | `stellar` CLI (`contract build`, `contract invoke`), testnet via friendbot |

Stellar is the core of the product, not a superficial integration: the entire tool exists to generate and prove the on-chain policy contracts that secure Stellar smart accounts.

## Proven on testnet (pre-funding)

The full pipeline has run against a real OZ smart account on Stellar testnet using exactly the generated params (0.6 XLM over 17280 ledgers). On-chain, inclusive-boundary checked:

- under-cap transfer allowed: [`a3d1ecc3`](https://stellar.expert/explorer/testnet/tx/a3d1ecc31018e8eaa47511651c57effe8fd92318f23b5a7ea3c0219ceade1a9b)
- over-cap transfer rejected with `SpendingLimitExceeded` (#3221): [`da5d045b`](https://stellar.expert/explorer/testnet/tx/da5d045bedd652f04c49360a9e72a0c7c9e4697ca9e4862db5aa3bbafbc5dd02)
- exact-cap transfer allowed (inclusive): [`d6226404`](https://stellar.expert/explorer/testnet/tx/d6226404d92154d9380de1cd9cd1862801253575e86223417460b729a9f8fc50)
- cap-plus-one-stroop rejected (#3221): [`f85d5faf`](https://stellar.expert/explorer/testnet/tx/f85d5faf87c5063ddfafea661d271ba28879a7c93b94e51c8376c78591bf52d2)

Contracts (testnet): policy `CALRGXGNJ4S7HTKCKKBNIJDBE7GQHCXW3MI63ZUBI6LXACYU2IJSNJDI`, smart account `CDZSCRAG2VM6MJSWTRMFPHP2QTX3OTNGFTQGSPZ7WEG7UUD4FK6GRRBE`, ed25519 verifier `CCK524HSVDEQBYZ2AYOQCTF5C2HLYN4VL5GRT26CTVXCA5F4IAPHYTAC`. Full reproducible record (every command, the `__check_auth` signing flow): [`docs/testnet-proof/REPORT.md`](./testnet-proof/REPORT.md).

## Funded scope (Stellar-specific)

- **Tranche 1:** production installer wrapping the validated `add_context_rule` + `__check_auth` signing flow for Stellar smart accounts; emit hardened for multi-asset (multiple SAC) accounts.
- **Tranche 2:** inference for threshold and weighted-signer policies and context-rule suggestions from the observed counterparty graph; an AI-assist layer that explains each policy and flags anomalies over the deterministic core.
- **Tranche 3:** mainnet deployment against a live OZ smart account; published CLI; golden conformance vectors for policy decisions so Stellar wallets and integrators can validate independently.
