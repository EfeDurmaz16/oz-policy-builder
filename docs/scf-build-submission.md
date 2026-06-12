# SCF #44 Build Award — full submission draft (RFP Track)

Paste-ready answers for the SCF Build form. Target RFP: **OZ Accounts Policy Builder** (Q2 2026). Deadline: June 14 EOD.

---

## Track

**Build Award — RFP Track.** Open RFP addressed: "OZ Accounts Policy Builder".

## Project name

OZ Accounts Policy Builder

## One-liner

Generate OpenZeppelin Stellar smart-account policies from observed or simulated transactions, with a deterministic core, human-readable rationale, and a simulator that proves each policy against real on-chain history before it is installed.

## Problem and use case

OpenZeppelin's `packages/accounts` ships the smart-account policy primitives (`spending_limit`, threshold and weighted signers, context rules), but a developer still has to hand-pick the numbers and hope they match how the account actually behaves. Too tight and legitimate payments break; too loose and the policy is theater. There is no tool that derives a defensible policy from real account activity and proves it before install. This RFP asks for exactly that, and it is the discipline our payment-SDK work is built on: deterministic engines, golden vectors, simulation before deployment.

## Stellar integration (technical)

- **Observe:** pull an account's outgoing transfers from Horizon / Soroban RPC and distil a behaviour profile (window, totals, p95/max transfer, per-day rate, counterparties, assets).
- **Propose:** infer `SpendingLimitAccountParams` (`spending_limit` in stroops over a rolling `period_ledgers` window) with safety headroom, floored at the largest legitimate transfer, with a written rationale for every number.
- **Simulate:** replay the history against the proposed policy using the same rolling-window eviction semantics as OZ `spending_limit.rs`, reporting allowed vs blocked.
- **Emit and install:** produce install-ready params and drive the real OZ smart-account flow (`add_context_rule` with a `CallContract` rule, the smart account's `__check_auth` signing, `add_policy`).

Stellar is core, not superficial: the whole tool targets OZ's Soroban smart-account policy contracts and the Stellar account model. It meaningfully improves a core ecosystem building block (smart-account security) rather than using Stellar for storage.

## Current traction (validated need + working build)

Public MVP, already proven end to end and on-chain: **github.com/EfeDurmaz16/oz-policy-builder**.

- Live Horizon fetcher tested against mainnet: 200 real payments profiled, policy proposed, 200/200 legitimate transfers pass; IQR-based outlier flagging.
- **On-chain enforcement on Stellar testnet against a real OZ smart account**, using exactly the generated params (0.6 XLM over 17280 ledgers). Inclusive-boundary checked: under-cap and exact-cap transfers allowed, over-cap and cap-plus-one-stroop rejected with `SpendingLimitExceeded` (#3221). Transaction hashes and the full reproducible record (including the `__check_auth` signing flow) are in the repo under `docs/testnet-proof`.

This is milestone 0, completed pre-funding, so reviewers can verify the approach works before committing a single tranche.

## Differentiation

No existing tool derives an OZ Stellar smart-account policy from observed behaviour and proves it on-chain before install. The closest prior art is hand-written policy params and generic block explorers. The deterministic, reproducible core (no model in the critical path) plus an on-chain simulation harness is the unique angle, and it is already running.

## Team

Solo. Efe Baran Durmaz, payments-protocol engineer (github.com/EfeDurmaz16, linkedin.com/in/efe-baran-durmaz). 500+ open-source PRs; 40 merged in solana-foundation/pay-kit (MPP/x402 payment SDKs across 9 languages, funded by a Solana Foundation grant); 7 of 8 merged in x402-foundation/x402; merged work in stripe/mpp-rb and the tempoxyz MPP SDKs; author of the Sardis spending-policy engine whose rolling-window limit inference this tool mirrors. Note: the prior grant is from the **Solana** Foundation, a different foundation; this is net-new Stellar work with no scope overlap.

## Open-source plan

Already MIT-licensed and public from day one (github.com/EfeDurmaz16/oz-policy-builder). All smart-account integration code, the policy engine, and the conformance vectors ship open-source. No closed components.

## Roadmap and tranches

Total ask: **$45,000** in XLM (well under the $150k cap; sized to solo engineering hours over ~4 months, per the budget guidance to not over-ask). Milestone 0 (testnet enforcement) is already delivered and is not billed.

| Tranche | Deliverable (clear, measurable, verifiable, outcome-based) | Share | Amount |
|---|---|---|---|
| **#0 Acceptance** | Project kickoff; published plan and repo baseline. | 10% | $4,500 |
| **#1 Production installer (MVP)** | One-command testnet installer wrapping the validated `add_context_rule` + `__check_auth` signing flow; emit hardened for multi-asset and Token-2022-style accounts. **Proof:** `oz-policy install <account>` derives and installs a policy on a fresh testnet OZ smart account, end to end, in one command, with the install tx hash printed. | 20% | $9,000 |
| **#2 Policy coverage + AI assist (testnet)** | Threshold and weighted-signer inference and context-rule suggestions from the observed counterparty graph; multi-asset profiles; an LLM-assisted layer producing natural-language policy explanations and anomaly triage over the deterministic core. **Proof:** for a sampled testnet account, the tool proposes a multi-policy context-rule set, installs it, and the on-chain simulation shows the history passing and seeded anomalies blocked. | 30% | $13,500 |
| **#3 Mainnet + distribution** | Mainnet deployment path; published CLI; hosted demo; docs; golden conformance vectors for policy decisions so wallets and integrators validate independently. **Proof:** a policy generated and installed against a mainnet OZ smart account (small live deposit), the published CLI on npm, and a conformance-vector file other SDKs can run. | 40% | $18,000 |

Timeline: ~4 months, mainnet by tranche 3, within the 6-month cap.

## Budget alignment

Every line is eligible development work (Soroban integration, inference engine, testing/QA, mainnet deployment, docs, SDK/conformance). No audit costs (handled separately by Audit Bank if needed), no marketing, no past-work reimbursement, no entity/legal.
