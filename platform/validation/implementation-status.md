# 10X.MEME implementation handoff

Reviewed **5 November 2026**. This branch implements a local, API-first rehearsal of the approved November PRD v1.2. It has no production deployment, funded pilot, live signer or enabled financial execution. Synthetic records and imported observations are labeled in the API and interface. Passing local tests does not establish custody safety or approve a candidate protocol.

The editable PRD v1.2 remains the product source of truth; this file records implementation evidence and unfinished engineering. The governing document is supplied alongside the checkout as `outputs/10X_MEME_PRD_v1_2.docx`, with extracted text in `work/prd_content_v1_2.txt`. Those workspace artifacts are not repository files. Retain the approved document with the release review. The existing Warplets Base community product and Stonklets maintenance scope remain separate from the new Solana economic product.

## Implemented slices and release gates

| Area | Implemented and locally reviewable | Required before production use |
| --- | --- | --- |
| API and identity | Versioned OpenAPI, generated typed client, explicit units/envelopes, bounded requests, message-only Ed25519 wallet authentication, session revocation and owner-scoped reads. | Hosted origin/cookie configuration, deployed storage parity, rate limits and end-to-end operational review. A valid local session is not proof of chain balances. |
| Standard web frontend | Standalone React/TypeScript client; public Markets, Collections, Vault, Stake and Earn routes; canonical detail pages, share metadata, responsive views, Wallet Standard and injected-wallet adapters. Optional Mini Apps are not required for navigation or identity. | Physical desktop/mobile signing and deep links, accessibility/device acceptance, production hosting and selected wallet compatibility. See [site guide](../site/README.md). |
| Economics and launches | Integer 80/10/5/2.5/2.5 allocation, conservation and vesting models, actual-activation fee schedule, launch manifest/planning checks and append-only local catalog. | Exact selected token/pool configurations, current binary/configuration evidence, funded custody for all allocations, fee rights and independent release review. |
| Price evidence and quotes | Pinned ATT/OG identities, source/freshness/depth/movement gates, missing-evidence holds; BigInt exact-input buy/sell quotes, gross buy FDV, expiry and slippage; 80 pinned SDK vectors. | Authentic RPC/oracle adapters, trustworthy common-slot snapshots and historical checkpoints, exact pre-swap program-state parity, transaction simulation/network costs. Read-only quotes create no trade transaction. See [quote scope](../quotes/README.md). |
| Vault | All reserved Genesis slots accrue before mint; weighted allocation, original launch vesting, owner transitions and claim projections; local mint-to-slot binding. Captured Core + Rewards composition demonstrates ownership-sensitive payout in a narrow fixture. | Permanent transferable custody, reserved slot authority, asset/plugin/burn and metadata policy, durable proof availability, marketplace behavior, exact funded payout instructions and full costs. A database projection is not an enforceable claim. |
| Stake | Continuous farm reference arithmetic, earned/idle separation, principal and harvest projections; captured Kamino fixture exercises accrual, harvest and withdrawal/re-stake. | Principal protection from administrative powers, selected configuration/fee evidence, arbitrary emission precision, permitted usage, exact production instruction adapters and fund reconciliation. See [protocol findings](protocol-status.md). |
| Earn | Authenticated admission; global best eligible post and Top 100; both stake thresholds; derived configurable actions, rolling streak, NFT and purchase components; capped integer awards/burn; final moderation, bootstrap and activation-based vesting. | Real evidence providers, staffed moderation, complete cutoff observations, audited funded distributor, on-chain burn/recovery/claim reconciliation. The 100-admission pilot ceiling is an explicit local workload bound, not a change to global ranking policy. |
| Earn durability | Atomic immutable board/award writes, replay-safe allocations, privacy-separated archives, pinned commitments, inclusion proofs and additive restore. Owner claim previews retain old entitlements. | Independent archive publication/retention, production backup drills, trusted chain reconciliation and the selected distributor's proof format. Local SHA-256 archive proofs do not substitute for program verification. See [Earn guide](../earn/README.md). |
| Genesis and Seasons | Bounded fixture inventory, per-stage mint eligibility, advisory ASAP/7/14/30 voting, frozen electorate and final founder decision; reveal, free-phase snapshot, upgrade/reroll and cooldown state; request locks and durable receipts. | Complete ownership/whitelist sources, paid fulfillment, trusted reservation ordering, reveal and entropy timeout/refund policy, external transfer/marketplace compatibility and measured storage scaling. No app burn action exists. |
| Fair assignment candidate | Optional signed-beacon verifier pins future rounds and committed inventory, preserves retry outcomes and checks a real captured signature. | Selected randomness provider and cost; trusted admission/payment boundary, permissionless fulfillment, withholding/timeout behavior and slot authority. This is feasibility evidence, not a selected production provider. See [beacon guide](../beacon/README.md). |
| Transaction recovery | Strict local legacy/v0 plan/packet checks, owner signature verification, immutable business identity, attempts and unknown-outcome reconciliation. | Trusted network observations, typed production instruction factories, fresh lookup/blockhash/simulation data and a separately approved broadcaster. The local adapter has no broadcast method. |
| Operations and audit | Private loopback moderation console; prospective staffing/admission limits; scoped pauses; optional-cost reservations and settlement; append-only configuration audit; scoped onboarding proof issuers. | Hosted operator authorization, external evidence signers, independently retained audit checkpoints and measured service quotas. Controls cannot pause principal withdrawal, harvest or existing claims. |
| Notifications | Explicit per-wallet opt-in, topic scope, local inbox, revocation, bounded replay-safe leases, unknown-outcome reconciliation and retention limits. | Selected delivery adapter, provider cost/privacy review and operational consent handling. No external messages are sent by this implementation. |
| Cost and capacity | Fourteen PRD cost scenarios, separate SOL/USD/OG and payer provenance, unknown terms, refund versus consumed cost, budget planning and measured local 100/1,000/10,000-request cases. | Fresh all-in message/rent/provider quotes, verified available cash, D1 billed units, live RPC bounds and actual staffing. Local latency and reference rent values are not production capacity or prices. |

## Node and Worker are different completion scopes

The **Node reference service** in `server/` is the complete local workflow host. Node 22.16+ and `node:sqlite` provide the durable fixture ledger, operator CLI integration and public/member APIs. The standalone React build is served when present; an install-free reference viewer is available otherwise. Preview and demo bind to loopback. The demo uses disposable in-memory data; the ordinary preview uses an isolated local SQLite file.

The **Worker adapter** in `edge/` is a narrower local D1/R2 implementation, explicitly restricted to loopback hostnames. Its filtered OpenAPI exposes policy/health, planned collections, fee schedule, markets and digest-verified manifests, wallet authentication, Vault/Farm projections, Earn board/claim reads and Genesis ballot reads/voting. It does **not** yet host the full Node Earn write pipeline, collection operations, quote adapter, notification workflow, operator console or configuration controls. Moving code to a Worker requires adapter-specific transactional/concurrency and migration validation; Node test success does not imply D1 parity. Existing production Workers and bindings are outside this local adapter.

## Founder choices intentionally left open

- **Sydney launch window:** choose the staffed window before publishing it. Around 6 am and around 9 pm Australia/Sydney remain alternatives; neither is selected. Actual activation starts each token's clock. The approximate 60-minute operating window and ability to skip a missed day do not require a fixed daily activation timestamp.
- **Later mint prices:** the first Genesis whitelist stage remains **0.1 SOL**. Later Genesis stage/tranche prices and later sale terms remain unset until explicitly published. Illustrative demo prices are fixtures, not approvals. Preserve the required stage notice and one mint per eligible wallet per stage.

Supported wallets/marketplaces, randomness enrollment and protocol configurations depend on the listed compatibility tests. Report evidence and a costed choice when needed; do not reopen settled tokenomics, pillars, final moderation policy, revealed-1X eligibility or API-first architecture.

Planning targets remain below US$10 for the first paid test, a founder-approved exception up to US$30, and US$5 combined new recurring services per month. The 50% cash reserve is advisory; it is not an automatic rejection rule. No cost model grants spending or deployment authorization.

## Validation evidence and reproduction

The coordinating review passed **126 Node reference tests** after adding the populated demo and its real loopback HTTP sign-in/reservation journey. The local Worker integration and two signed-beacon tests also passed. The React build passed, the operator journey passed staffing/review/reload/logout at four viewport widths, and the populated demo was visually inspected at 390 and 1440 pixels with no horizontal overflow. Browser tests use disposable keys and databases. [The full Linux checkpoint at a878968](https://github.com/chrisjacob/warplets-api/actions/runs/42015181617) passed before the final demo style and member-test additions; the checkpoint file triggers another clean build for those changes.

The Earn/contracts slice was rerun on **5 November 2026** with Node **22.22.3**: **62 tests passed, zero failed**, and generated-contract drift check passed. That scoped count includes economics used by Earn, board/recovery, pricing, onboarding issuers, notifications, operating costs, API/client integration, quotes and the 14-scenario cost planner. It is not the repository-wide test total. Quote tests include 80 SDK cases within one test; do not count those as 80 additional test-runner tests.

From the repository root:

```text
node platform/contracts/generate.mjs --check
node --test platform/domain/earn/*.test.mjs platform/earn/*.test.mjs platform/pricing/*.test.mjs platform/notifications/*.test.mjs platform/operations/*.test.mjs platform/contracts/*.test.mjs platform/quotes/*.test.mjs platform/costs/*.test.mjs
```

Additional commands below identify the respective checks; they do not assert an aggregate result in this handoff. Install each isolated package with its frozen lockfile and lifecycle scripts disabled when dependencies are absent. No deployment command is needed.

```text
# Full Node reference suite (excludes separate edge/site packages)
node platform/scripts/test-reference.mjs

# React typecheck/build and unit tests
pnpm --dir platform/site test
pnpm --dir platform/site build

# Local Worker adapter typecheck and D1/R2 integration
pnpm --dir platform/edge typecheck
pnpm --dir platform/edge test

# Disposable recovery, capacity and concurrent-replay exercises
node platform/earn/recovery-drill.mjs
node platform/performance/earn-load.mjs 100 1000 10000
node platform/performance/replay-race.mjs

# Read-only cost comparison; incomplete terms remain explicit
node platform/costs/cli.mjs --compare
node platform/costs/cli.mjs --reference
```

Browser checks and environment paths are documented in the [site guide](../site/README.md). Measured workload figures, query plans and RPC assumptions are recorded in the [performance report](../performance/README.md). The [dated protocol report](protocol-status.md) records the completed captured-program CI, observed account/binary evidence, limitations and remaining custody problems; its passing fixture results are not approval to deploy. Retain exact command outputs and source commit with the final release packet. The coordinating review adds repository-wide totals separately.

## Next engineering milestones

1. **Close the custody feasibility gates.** Resolve Kamino principal administration and precision; select an enforceable Vault ownership/plugin policy compatible with metadata and claims; reconcile funded Earn custody. Carry the concrete failed requirements and exact costs into the decision. Do not enable financial writes on projections alone.
2. **Add real read adapters first.** Verify current pool/OG/farm/ownership observations, historical cutoff completeness and provenance. Pair quote outputs with the exact pre-swap captured program state. Add monitoring that holds new work on stale or incomplete evidence.
3. **Port the chosen hosted slice.** Extend D1/R2 only with explicit route ownership, conditional transitions, scoped idempotency, archive publication and adapter-specific replay/recovery tests. Measure billed usage and moderator capacity before increasing admissions.
4. **Complete fulfillment and device acceptance.** Bind paid mints and progression to trusted reservations and fair assignment; validate marketplace transfers, physical wallets, deep links, packet review and ambiguous receipt recovery. Publish actual stage terms only after these gates pass.
5. **Prepare an approval-ready pilot packet.** Include exact program/configuration identities, current cost quotes and cash, payer responsibilities, source commit, acceptance results, recovery runbook and unresolved limitations. A funded canary and production deployment require a later explicit authorization; this work does not perform either.

