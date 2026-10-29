# Local implementation and delivery milestones

## Boundaries

`meme/` is an independent workspace package with React UI, Worker API, shared domain contracts and a separate local D1 migration directory. It imports neither the archived discovery package nor Network internals. Production routing, the shared production database, deployed Workers and Pages builds remain independent of this skeleton.

The default UI reads persisted local state; `?fixture=1` retains the typed read-only design preview. Worker APIs return no-store responses and require both local-mode configuration and a loopback request hostname. Mutations require a matching Origin. Opaque sessions bind verified Farcaster assertions to host-scoped HttpOnly cookies. Single-use challenges verify Base SIWE and Solana Ed25519 wallet proofs. Local operator bearer tokens are hashed in the isolated database. There is no production hostname, scheduled trigger, transaction signer or remote resource.

`packages/connect` contains the existing reviewed Connect UI and authentication primitives; compatibility exports preserve the other products. Launchpad domain code imports no app, discovery or Network runtime. Database rows and live API timestamps use integer UTC milliseconds; fixture contracts retain ISO strings. Token amounts are integer decimal strings; multipliers use fixed integer units and holding credit uses BigInt fractions. These are internal local contracts, not a public trading API.

Adapters isolate verified identity, frozen Base ownership, supporting screening evidence, Solana launch execution and distribution. Future adapters may extract small reviewed security/arithmetic components with their relevant tests. Reuse never brings the archived discovery Worker or its research machinery into the runtime graph. Ownership uses the confirmed Warplets source behind its activity feed, through a read interface; Network materialized analytics are insufficient for reward authority.

## Implemented data flow

Verified participant → pre-reveal ownership freeze → vote with frozen reward/holding wallets and first-valid timestamp → close-time holding/streak calculation → frozen ranked settlement → immutable **unfunded** entitlements. Attribute cycles commit a seed before opening and reveal their complete order after the cycle. Operator selection or skip is independent of reward allocation. Actual launch metadata starts ten release times; no API here executes a launch.

The holding ledger replays acquisition lots, top-ups, airdrops, proportional disposals, scoped transfers and rebuys with immutable provenance. Finalized receipts can be reconciled through a bounded public Solana RPC adapter. History completeness and historical price evidence remain source-attested, and supported receipt coverage is deliberately narrow. Unknown coverage blocks settlement. A missing live indexer or independent price source must never become an implicit zero balance.

Settlement stores a versioned context hash and one immutable input row per voter. Each request writes at most 40 input or entitlement rows; repeated calls resume from durable counts. A finalized job returns its existing proof without recomputing old rewards. SQL constraints prevent double allocations, immutable source-prefix triggers reject late observations, and manifests reject input drift during recovery. Missing offered rounds require an explicit audited reserve record. See BUILD.md for arithmetic, release windows, operator recovery and the separation between finalized, funded and claimable states.

## Delivery gates

| Milestone | Deliverable and acceptance |
|---|---|
| Foundation — complete locally | Authoritative docs, isolated database, typed fixtures, independent builds/tests, no production exposure. |
| Identity and rounds — complete locally, PRs #86–88 | Shared Connect, verified identity/wallets, frozen ownership, changeable votes, wallet/NFT reservations and operator selection/skip. Local working timetable and duplicate controls are versioned; production abuse review remains. |
| Boost and holding ledger — complete locally, PRs #89–90 | Committed attribute cycles, streaks, exact additive 10× cap and replayable acquisition credit with sealed evidence. Live indexing/quote verification and production economics remain gates. |
| Settlement — complete locally, PR #91 | Deterministic top 100, earliest-vote/FID ties, exact proportional allocations, empty/unoffered reserves, frozen inputs, immutable unfunded entitlements and bounded resumable jobs. |
| Protocol/distributor feasibility | Pin supported integrations and prove single-sided OG pairing, fee collection, decay, lock authority, recovery and distributor costs. Resolve liquidity, fees, lock and treasury decisions. No mainnet funds in this milestone. |
| One complete cycle | Shortlist → vote → selection/skip → launch → allocation no earlier than +24h → funded claim, initially in a controlled non-production environment. |
| Overlap and recovery | Ten overlapping campaigns; +240h final release; skipped launches; delayed/failed launches; unavailable providers; replayed jobs; partial and duplicate claims; ownership changes. |
| Production readiness | Final protocol/operating review, abuse rules, key authority, treasury disclosure, cost budgets, monitoring, incident procedures and explicit release configuration. Only then expose live mutations. |

## Verification

Run the package check command for frontend/Worker typechecks, real SQLite migration replay, cryptographic proof tests, request-boundary regressions, exact arithmetic/replay/recovery tests, frontend build and Worker dry-run bundle. Apply only local migrations to the isolated state directory. Inspect mobile and desktop, each tab, shared Connect and disabled financial controls. CI also runs the existing app regressions and production manifest checks. It does not deploy.
