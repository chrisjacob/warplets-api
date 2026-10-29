# Foundation and delivery milestones

## Boundaries

`meme/` is an independent workspace package with React UI, Worker API, shared domain contracts and a separate local D1 migration directory. It imports neither the archived discovery package nor Network internals. Production routing, the shared production database, deployed Workers and Pages builds remain independent of this skeleton.

The local UI reads typed fixtures. The local Worker exposes only GET/HEAD `/health` and `/api/meme/preview`, returns no-store responses, identifies the fixture mode explicitly, and rejects every mutation method. It constructs no production adapters or signing clients. It needs no credentials, public hostname, RPC service, bridge, transaction signer, scheduled trigger or remote resource.

Shared contracts cover participants, candidates/rounds, votes, boost breakdowns, editions/campaigns, entitlements and claims. They distinguish provisional and final records. Amounts are decimal strings and timestamps are UTC ISO 8601. Fixture identifiers are deliberately invalid onchain addresses. These are initial internal contracts, not a versioned public trading API or a complete accounting schema.

Adapters isolate verified identity, frozen Base ownership, supporting screening evidence, Solana launch execution and distribution. Future adapters may extract small reviewed security/arithmetic components with their relevant tests. Reuse never brings the archived discovery Worker or its research machinery into the runtime graph. Ownership uses the confirmed Warplets source behind its activity feed, through a read interface; Network materialized analytics are insufficient for reward authority.

## Future data flow

Verified participant → round vote with preserved first-valid timestamp → close-time holding/streak calculation plus pre-reveal ownership snapshot → immutable ranked settlement → funded campaign allocations → distributor adapter → claim reconciliation. Selection/skip and actual launch timestamp are explicit operator outcomes. Candidate feeds suggest candidates but do not gate rounds, settlement or claim reads.

The future ledger must replay acquisition lots, top-ups, airdrops, proportional disposals, same-account transfers and rebuys with provenance. Settlement, launch and distribution require persisted idempotency keys and recoverable states before enabling mutations. Their schemas and protocol settings follow the decision gates, rather than being guessed in the skeleton.

## Delivery gates

| Milestone | Deliverable and acceptance |
|---|---|
| Foundation — this branch | Authoritative docs, decision register, isolated local database marker, typed fixtures, disabled daily-flow shell, independent builds/tests, no production exposure. |
| Identity and rounds | Verified Farcaster identity and wallet linking; one changeable vote per round; frozen ownership before reveal; duplicate wallet/NFT prevention; operator selection or skip. Resolve eligibility/abuse and timetable decisions first. |
| Boost and holding ledger | Replayable acquisition-value accounting and finalized 10× boosts. Resolve normalization, valuation inputs, disposal/top-up timing, transfer verification and exact rounding before implementation. |
| Settlement | Deterministic top 100, earliest-vote ties, proportional allocations, empty rounds, immutable entitlements, overlapping campaign simulation and retries. Resolve qualification, empty-round and remainder rules first. |
| Protocol/distributor feasibility | Pin supported integrations and prove single-sided OG pairing, fee collection, decay, lock authority, recovery and distributor costs. Resolve liquidity, fees, lock and treasury decisions. No mainnet funds in this milestone. |
| One complete cycle | Shortlist → vote → selection/skip → launch → allocation no earlier than +24h → funded claim, initially in a controlled non-production environment. |
| Overlap and recovery | Ten overlapping campaigns; +240h final release; skipped launches; delayed/failed launches; unavailable providers; replayed jobs; partial and duplicate claims; ownership changes. |
| Production readiness | Final protocol/operating review, abuse rules, key authority, treasury disclosure, cost budgets, monitoring, incident procedures and explicit release configuration. Only then expose live mutations. |

## Verification

Run the package check command for frontend/Worker typechecks, request-boundary regressions, frontend build and Worker dry-run bundle. Apply local migrations and verify the schema in the package's isolated state directory. Inspect the shell at mobile and desktop widths, including each tab and disabled controls. Validate that the shared app production manifest contains no `meme/` entry. CI runs the skeleton independently; it does not deploy it.
