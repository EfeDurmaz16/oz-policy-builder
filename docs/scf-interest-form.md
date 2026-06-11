# SCF Interest Form — draft answers (RFP Track: OZ Accounts Policy Builder)

Paste-ready answers; adjust names/links before submitting at communityfund.stellar.org.

**Project name:** OZ Accounts Policy Builder

**One-line summary:** Generate OpenZeppelin Stellar smart-account policies from observed or simulated transactions, with a deterministic core, human-readable rationale, and a simulator that proves the policy against real history before it is installed.

**Track:** Build Award — RFP Track. Target RFP: "OZ Accounts Policy Builder" (Q2 2026).

**What we are building:** A toolkit that closes the gap between OZ's policy primitives (`spending_limit`, threshold signers, context rules in `packages/accounts`) and the numbers a developer actually installs. Pipeline: (1) observe an account's transfers from Horizon/Soroban RPC, (2) infer policy parameters with safety headroom and a floor at the largest legitimate transfer, (3) simulate the proposed policy against the observed history with the same rolling-window semantics as `spending_limit.rs`, (4) AI-assisted layer that explains every chosen number and flags outliers, on top of a model-free reproducible core, (5) emit install-ready policy config and deploy against a real OZ smart account.

**Working MVP (already public):** github.com/EfeDurmaz16/oz-policy-builder — observe/propose/simulate stages working end to end: live Horizon fetcher (tested against mainnet: 200 real payments profiled, policy proposed, 200/200 legitimate transfers pass, drain-sized transfer blocked), IQR-based outlier flagging, 11 passing tests.

**Who:** Efe Baran Durmaz, payments-protocol engineer. 500+ OSS PRs; 40 merged in solana-foundation/pay-kit (MPP/x402 payment SDKs in 9 languages, funded by a Solana Foundation grant); 7/8 merged in x402-foundation/x402; merged work in stripe/mpp-rb and tempoxyz mpp SDKs. Specialty: payment-protocol wire formats, policy/limit decision engines (author of the Sardis spending-policy engine this tool's inference mirrors), cross-SDK conformance testing.

**Why us for this RFP:** The hard part of this RFP is not the UI, it is inferring defensible limits from messy behaviour and proving they will not break legitimate traffic. That is exactly the discipline of our payment-SDK work: deterministic engines, golden vectors, simulation before deployment. The MVP already demonstrates the approach on live mainnet data.

**Milestones (sketch, to be detailed in the Build form):**
1. Soroban integration: emit install-ready policy config; deploy and exercise against a real OZ smart account on testnet; on-chain simulation test (generated cap accepts observed history, rejects out-of-window drain).
2. Policy coverage: threshold and weighted-signer inference, context-rule suggestions, multi-asset profiles.
3. AI-assist layer: LLM-backed natural-language policy explanation and anomaly triage over the deterministic core.
4. DX: hosted demo + CLI + docs; golden conformance vectors for policy decisions so wallets/integrators can validate independently.

**Funding ask:** scoped per milestone in the Build form; anchored to the RFP's expectations rather than the $150k cap.
