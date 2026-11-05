# Portable application boundary

The Node Earn admission, final moderation, board settlement, allocation, leaderboard and member reads now exercise injected services/repositories. The operator HTTP handler delegates its atomic final review and immutable retry to the service. CLI exports remain synchronous. SQLite transactions contain no awaited callbacks.

Settlement is split into a consistent reference read, portable pure computation, and a guarded synchronous commit. The reference repository hashes the entire loaded input and rechecks it under BEGIN IMMEDIATE, recomputes the proposed output, and rejects stale or forged plans. A single revision conflict causes one service recomputation; persistent contention returns pending. Failed child writes roll back the board/allocation and all children.

`ports.ts` fixes reference DTOs and the B02 guarded command/evidence/job/artifact contracts. These are explicitly separate: a reference result is not a durable fenced receipt. B02 implements monotonic SQL revisions, durable command receipts, current authority and lease predicates, minimum operating controls and private immutable storage through separately typed adapters. B03 job and B04 recorded-evidence services are separately injected through typed ports; unsupported runtime contexts retain explicit deferred ports. Reference `sourceComplete` is still an operator attestation; B05 replaces it with enumerated cutoff coverage.

The golden fixture runs admission, review, board and allocation through the service and preserves the historical board/allocation/proof commitments. Portable computation has no Node, storage, fixture or provider imports. Semantic archive commitments remain separate from exact-byte object hashes. Public capability and financial execution flags remain unchanged.

Validation: 139 reference tests, pinned edge TypeScript, portable bundle, contract drift and recovery passed for ce59dee. Sanitized evidence is in platform/validation/runs/2026-11-06-overnight/B01.json. Next: B02 atomic repositories and operating controls; B09 frontend work continues independently.

B02 migrations 022–024 add guarded admission/review, controls, private references and fenced board/allocation commits. A complete-input pointer is a storage prerequisite; B05 must establish its coverage. Tests use explicitly synthetic manifests. The 100-wallet workerd board batch uses 303 statements, at most 29 parameters per statement and 208778 encoded bytes; input reads use at most 12 batches. Legacy 001–021 fixture upgrades preserve commitments and awards.

Lease predicates check database execution time as well as application preparation time. Trusted fixture drivers alone override the SQL clock. A reproduced post-preparation transport-delay expiry now returns conflict with no child effects; actual workerd SQL clock rejects expired leases and accepts current ones.

B03 supplies a local fenced runner, durable source outbox, metered recorded-read dispatch and bounded deadlines. B04 supplies immutable source/receipt provenance with current-head correction semantics. Neither introduces a public mutation route or live scheduler. Exact-cutoff completeness remains B05 work.
