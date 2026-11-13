# Performance valuation contract — 13 November 2026

This projection implements the supplied Product UX & Performance Leaderboards handoff. It is a separate read-only model, not a new financial ledger or a replacement for settlement/vesting. Only explicitly labelled synthetic-local snapshots are accepted in this milestone. Default application instances return unavailable until a dataset is injected.

## Quantities and prices

Each unique reward allocation has one immutable ID, one recipient, token and originating category (NFTs, Stake or Earn). Exact duplicate IDs are idempotent; conflicting IDs fail validation. Airdrops is a union of these records, never another source category. Awarded, vested and claimed quantities remain distinct; claimable = vested minus claimed. Unawarded future emissions and inconsistent claim state are rejected.

ATT/USD is calculated from contemporaneous ATT/OG and OG/USD observations (maximum 60-second timestamp difference), with traceable source and pool identifiers. Rejected observations retain a reason and do not affect ATH. Accepted observations must be positive, nonfuture and after launch. Brief valid peaks are included, including peaks before a recipient's award. The latest accepted observation is usable as snapshot Market only if within 15 minutes of snapshot time. Missing/stale prices produce null valuations and unranked counts, never zero-valued evidence.

All calculations use BigInt rational arithmetic. Values are returned as integer USD micro-units, rounded down only after aggregating a wallet's same-token quantities. Token launch reference prices allow fractional micro-units. No floating-point token balance arithmetic is used. Categories rounded separately may differ from a consolidated total by micro-unit rounding; the consolidated total is always computed from unique allocations, not summed displayed category numbers.

Peak uses global ATH; Market uses current snapshot prices on the same lifetime awarded quantities. Neither is realised income or proceeds. Current wallet holdings, claimed quantities and trade cost basis do not determine these theoretical values. Token performance is ATH/launch or current/launch, never Peak/Market.

## Ranking and bounds

Reward boards rank by the selected USD valuation. Token boards rank by the selected price/launch ratio and show FDV, not a wallet return. Unknown valuations are excluded from ranking and counted separately. Equal metrics use stable participant-ID ordering; ordinal ranks are deterministic. Default Peak and optional Market are the only modes. Boards return at most100 rows, with the authenticated participant's rank separately, including ranks outside100. Token breakdowns on boards are limited to3; profiles expose paginated full token quantities and claimability. Profile category ranks are explicitly Peak ranks.

Snapshot ingestion bounds: 5,000 tokens, 10,000 participants, 100,000 allocations, and1,000 observations per token. Aggregates and rankings are compiled once per snapshot. Requests perform bounded slicing/lookup rather than repeated full scans. These are local engineering limits, not claims about production traffic capacity.

## Routes

- GET /api/v1/performance/boards/{tokens|nfts|airdrops|stake|earn}?mode=peak|market&limit=1..100
- GET /api/v1/performance/profiles/{wallet}?cursor=0&limit=1..100
- GET /api/v1/performance/activity?limit=1..50

No write endpoints exist. Own rank derives from the authenticated session, not a client-supplied wallet parameter. Profiles and synthetic activity are public. Responses are no-store. No live holdings or private ledger are silently published into this dataset.

## Required before real publication

Choose and implement a reliable price source and observation-admission policy, including trustworthy launch references, pool identity/finality, manipulated or unreliable quotes, pair timing and outage handling. The current quality flag is an explicit synthetic fixture decision, not an automatic production oracle. Preserve valid brief peaks without treating arbitrary spot quotes as trustworthy.

Define how immutable awarded-recipient attribution and current NFT-owned entitlements interact on a public holder leaderboard after transfer. Obtain public-profile/privacy and ranking-period/tie-break approval. Connect canonical finalized allocation sources exactly once; do not infer payouts from provisional scores. No real publication, model spending, transaction broadcasting or release gate is authorized by this local projection.
