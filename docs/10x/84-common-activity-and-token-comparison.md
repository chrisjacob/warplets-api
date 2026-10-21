# Common activity records and three-token comparison

21 October 2026. Continuation of [F1/F2](82-next-product-functionality-plan.md) after [rotating coverage and searchable discovery](83-rotating-coverage-and-discovery-workspace.md). Current v4, every evidence/action/election gate, Free provider admission and no deploy remain. This is a read-only projection over existing archives, with no migration, new provider endpoint, collector, timer or score adoption.

## Completed

- [x] A versioned common activity observation format, keyed by chain/mint/cutoff/source/scope/metric, with units, actual windows, fetch/provider dates, coverage, denominators, qualification, source references and gaps.
- [x] Thirteen explicit metric slots per available saved token. Missing, held and rejected observations remain records; an absent token remains a comparison row.
- [x] Pool-reported volume, GMGN token reports, four-part candle volume/patterns, raw owner changes and selected-wallet reports use separate scopes. Raw quantities never become qualified organic volume or meaningful holder growth.
- [x] Cache-only comparison of one to three unique exact mints at a common review cutoff. The UI compares two or three selected tokens and preserves their selection in its shareable URL.
- [x] Selection controls on cards and table rows, with a three-token bound, independent removal, explicit comparison refresh, safe artwork and full mint disclosure.
- [x] Schema/hash verification of the exact displayed comparison, explicit source/window differences and cached last-success display after a failed refresh.
- [x] Updated API contract, backend/UI regression coverage and local cache verification. No deploy or historical row rewrite.

## Observation contract

`activity-observation-v1` records identify the measurement independently of its source scope. A pool report is not a token-wide total; a selected-wallet event page is not either of those populations. Scope also records that this projection grants no new canonical-pool certification. References to GMGN receipts and holder inventories replay their archived hashes; market snapshots are explicitly only content hashes of retained history, without a separately anchored provider receipt. No source authenticity is independently established by a checksum.

| Source / metric | Window and denominator | Qualification boundary |
|---|---|---|
| Retained market-provider 24h volume | Exact candidate-linked pool snapshot; declared 24h period, actual period endpoints unknown | Reported only. A general provider observation timestamp is not a documented volume-window endpoint. Missing/mismatched history is held or rejected |
| GMGN 24h/1h volume and holder count | Token report; rolling endpoints / holder measurement time remain unknown | Reported only; population and organic/dust filtering unknown |
| GMGN candle-window volume | Exact closed six-hour request, four parts, observed/expected minutes and original receipt hashes | Total withheld unless the requested window is complete and price-dimensional USD unit checks pass. This is same-provider corroboration, not independent trade verification |
| Largest adjacent candle move / rising run | Observed adjacent closed minutes within that actual request | Supported diagnostic sample; missing/conflicting bars stay gaps. No wash verdict or safety pass |
| Raw owner net change | Actual first/latest retained interval and starting raw owner denominator, with full-inventory replay | Supported raw sample only when inventories reconcile and their pool matches the candidate. Neither trailing-24h nor acquired/retained meaningful growth is inferred |
| Selected-wallet reported buy/sell USD | Replayed frozen largest-flow regular-wallet selection; at most twenty events and actual observed trade span | Reported page only; pagination, full query coverage, historical USD and independent transaction verification remain unresolved |
| Qualified organic 24h volume, meaningful 24h holder growth, attention momentum | Qualification not established | Always null/held in v1. Schema checks reject numeric substitutions |

Each metric carries its own freshness. Archived stale observations remain descriptive, with their dates; a fresh fetch does not refresh an old candle window or owner interval. Provider/fetch timestamps remain separate from actual measurement endpoints. Null values are never converted to zero. Qualified metrics cannot gain values through a source fallback or through missing-denominator normalization.

The latest selected info/activity attempt is authoritative for missingness: a later rejected attempt does not silently fall back to an older positive response. Verified rejection references and fetch dates are retained; corrupt references yield a rejected record without unverified values. Pending/after-cutoff receipts and candle parts cannot count as available at the review cutoff. Holder archive/byte/layout limits, four-part seam checks, wallet-selection binding and every original source rule remain.

## Comparison contract and UX

`GET /api/10x/discovery/compare?addresses=MINT,MINT[,MINT]&mode=live` accepts one to three unique Solana mints. It reads the requested saved candidate rows directly, including retained observations outside the visible top 100. Unknown mints do not trigger intake or a provider query. Duplicate/excessive mints, arbitrary source URLs and arbitrary historical-cutoff parameters are rejected. Fixture mode is isolated from live source archives and explicitly labelled simulation.

All v4 grades use the same server-selected cutoff. Candidate rows from after it are held; unusable scoring history withholds that grade while preserving other descriptive source observations. Comparison rows retain requested order and receive no fabricated global rank. Future market values are withheld from the displayed card. Different measurement windows, provider times, coverage and freshness remain visible per cell. There is no cross-provider total, synthetic organic leader sort or new action authority.

The browser verifies the schema-ordered display checksum, row/mint/mode/cutoff identities and observation uniqueness before accepting a report. This verifies the displayed projection, not upstream truth or a full private score-input replay. Comparison is not a paired-model study, a backdated candidate snapshot, a new score cohort or a claim that the source receipts were captured together.

Use **Compare** on cards or table rows, then **Compare saved observations**. Selecting a fourth token is disabled; selected tokens remain removable. Filters preserve selection, while changing live/fixture mode clears it. Selection and layout do not alter the ordinary candidates API identity or initiate a provider refresh. The comparison does not poll; **Refresh comparison cutoff** explicitly requests a newer cache projection. A failed same-selection refresh retains the previous verified cutoff. A changed selection cannot silently display the previous tokens' report. Artwork remains presentation metadata, can refresh independently, and contributes no trust points.

## Verification

- Backend targeted regressions passed across comparison, search, current v4, source receipts, candle windows, selected-wallet activity, holder history and request security. Tests cover zero IO/writes, exact source scope, unknown rolling endpoints even with a general observation timestamp, after-cutoff window parts, latest rejection/corruption, raw-owner interval/denominator, wallet-selection replay, token absence, fixture separation and query bounds.
- Discovery UI regressions passed, including three-token selection/removal, shared URL identity, source/window disclosure, unknown versus zero and display-checksum verification. Backend typecheck and application typecheck/build passed. Home startup remains 234.1 KiB gzip across eleven chunks; no deployment command ran.
- Real local cache verification froze `.tmp/discovery-comparison-live-47076556-85a4-498b-8e30-7e62ef52530f.json` at `2026-10-21T11:40:50.645Z`, display hash `48f4446cebe1b23dd5752e4febacbcffd4a6bc5be27360ee68a02772d42d27a7`. Two saved tokens each produced thirteen records; the original requested Kimchi mint was outside the saved inventory and stayed `not_found`. All qualified values remained null. The query used zero provider requests and database writes. This is product/source-contract verification, not a new token verdict or calibration outcome.
- The recovered browser preview also rendered and verified a two-token comparison at `2026-10-21T11:56:52Z`, with v4 scores, common cutoff, source coverage and held qualified metrics visible. Screenshot: `.tmp/discovery-token-comparison.png` (local verification artifact).
- Before this delivery, preservation digests covered 176 score cohorts, zero outcomes, 39 completed source receipts, 822 holder inventories, 72 wallet observations and 595 cached transaction bodies. Original row hashes and foreign keys are checked after verification; ordinary timer appends remain allowed.
- The local preview intermittently failed while its existing supervisor was recovering. Its three-starts-per-fifteen-minutes budget, ownership and stores were preserved; the cache smoke succeeded after a normal recovery. The Wrangler 4.126 debug log identifies `ProxyController` / `ProxyWorker` and `Network connection lost.`, consistent with an [open upstream report](https://github.com/cloudflare/workers-sdk/issues/15451). No SDK patch, upgrade or restart-budget bypass is claimed. A stable fix and the longer reliability qualification remain F5 work.

## Next work

1. Observe the daily rotation on at least three previously unreviewed live mints when existing admission permits; retain missing/rejected results. The earlier scheduled baseline remains spent today. New GMGN market-list contracts/weights/Free entitlement remain unverified and inactive.
2. Preregister F3's meaningful acquisition/retention, organic-volume and recent-attention qualification before outcomes. Apply thresholds to real dated source evidence; keep unsupported quantities descriptive or held.
3. Collect the broad prospective cohort and later-day holdout in a new study namespace before comparing v4/provider-derived/hybrid scoring or proposing v5 (F4). This comparison view does not satisfy those validation gates.
4. Continue F5's owned runtime reliability, archive/restore and production-bound restoration. Optional browser-local shortlists and later backing/campaign/launch phases keep their existing dependencies. No deploy.
