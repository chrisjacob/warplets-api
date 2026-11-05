# Implementation baseline

This is the inspected starting point for planning. Task B00 verifies it before editing. The product is a substantial local implementation; restarting it or merging the old October application would discard useful work.

## Existing evidence

At code commit cb376978af8565abdfb63ffe727ba3768190d248, [CI run 42016677922](https://github.com/chrisjacob/warplets-api/actions/runs/42016677922) passed 128 Node reference tests, four frontend tests, one workerd/D1/R2 integration test and two beacon tests. Browser exercises covered public/member routes, quotes, operator moderation and responsive widths. This is dated evidence, not proof that a future working tree passes.

The following documentation commit, 5f3caff, retained the governing PRD. [Implementation status](../validation/implementation-status.md) and [protocol status](../validation/protocol-status.md) explain scope and existing unresolved findings.

## Reuse map

| Existing path | Keep and extend | Current limitation |
| --- | --- | --- |
| platform/domain/economics | BigInt split, fee curve, exact reserved weights, cumulative vesting and continuous farm arithmetic | Reference arithmetic does not prove chain custody or provider rounding |
| platform/domain/earn | Ranking, components, token-day ledger, caps, burn and activation-based release windows | Requires verified application evidence |
| platform/domain/collections | Inventory, vote timing, UTC expiry and progression reducers | Payment and ownership inputs are currently fixtures |
| platform/server | Loopback HTTP, message-only wallet authentication and request boundaries | Node-specific storage, crypto and routing composition |
| platform/storage | Isolated migrations 001–018, 020–021, transactional SQLite fixture ledger | Synchronous callbacks and nested savepoints cannot be copied into D1 |
| platform/earn | Durable admissions, final reviews, snapshots, awards, proofs and restore | Operator imports and sourceComplete boolean are not independent cutoff coverage |
| platform/pricing and platform/quotes | Explicit checks, raw pool decoder, exact integer quote math, 80 SDK vectors | Synthetic provenance; no trusted historical provider pipeline; exact captured-state quote parity open |
| platform/launch | Cost/timing planner and atomic local campaign registration | No signed/funded launch orchestration |
| platform/vault and platform/stake | Shared read projections and immutable event accounting | No live claim or staking execution |
| platform/collect and platform/randomness | Per-stage reservations, concealed metadata, receipts and future-round binding | No trusted paid admission boundary or selected production NFT policy |
| platform/beacon | Verified captured quicknet signature and deterministic draw candidate | Candidate verifier is not a production provider selection |
| platform/transactions | Packet integrity, durable intents, attempts and unknown-outcome reconciliation | No broadcaster; observations are local fixtures |
| platform/contracts | OpenAPI, generated typed client, envelopes and runtime capabilities | Full service parity and general request/response conformance still need work |
| platform/site | React/TypeScript/Vite/Tailwind/TanStack web, Wallet Standard, canonical public pages and recovery UX | Does not yet use runtime capabilities to prevent unsupported feature requests |
| platform/web | Install-free reference viewer and useful browser fixtures | Keep as diagnostic fallback; avoid developing a second full product |
| platform/edge | Hono/Zod Worker with local D1/R2 and filtered OpenAPI | Narrow auth/read/vote subset; no full Node write workflows |
| platform/operations, operator and notifications | Local controls, spend ledger, audits, moderation console and consented inbox | Hosted authority/delivery and D1 parity incomplete |
| platform/costs and performance | Fourteen scenarios, payer separation, bounded load and replay evidence | Dated inputs and local timings are not live costs or D1 billing |
| platform/scripts/demo.mjs | Disposable populated demo and actual HTTP sign-in journey | Synthetic by design |
| platform/lab | Existing captured-program evidence | Preserve findings; a green replay does not clear incompatibilities |

## Concrete integration traps

1. SQLite transaction callbacks are synchronous. An async callback inside the present transaction helper would commit before awaited work finishes. Do not use it as an async repository wrapper.
2. Earn semantic commitment and R2 SHA-256 of serialized bytes are distinct. Preserve both identifiers.
3. Pricing currently accepts local-solana while quote fixtures use solana-local. Normalize only at an explicit fixture adapter boundary. Neither string may be relabeled as mainnet evidence.
4. Current quote captures expect aligned observations. Separate RPC calls cannot be made simultaneous by assigning one timestamp.
5. Current-state RPC is not a historical midnight snapshot. Exact-cutoff settlement needs captured or reconstructable history and an explicit coverage decision.
6. API runtime capabilities are available, but the React app assumes many Node-only routes.
7. Financial action handlers stay disabled. A typed client or private operator console grants no financial authority.
8. Full unminted Genesis and active Season reserves already exist in the accounting model. Do not replace these with minted-only totals.
9. The frozen-beacon candidate does not by itself prove payment ordering, non-withholding or NFT update authority.
10. Existing protocol evidence records unresolved Kamino administrative principal control and Core burn/metadata compatibility. Do not turn those records into passing gates because normal-path tests succeed.

## Branch and migration rules

Continue the existing isolated feature branch when it still contains the baseline. If the founder supplies a newer approved branch, inspect its ancestry and preserve its changes. Do not reset, rebase, force-push or merge the October branch as a shortcut.

All new application work stays under platform/. Only test-only workflows may change outside it unless a later task explicitly justifies a shared-module edit and legacy regression coverage. Do not modify existing production routes, databases, crons, secrets or root lockfiles.

The next migration number is 022 at this baseline. Leave the historical 019 gap alone. Claim migration numbers centrally in RUN_STATE. Never edit an already-applied migration. Additive changes must support both a fresh database and upgrade from the previous local schema.
