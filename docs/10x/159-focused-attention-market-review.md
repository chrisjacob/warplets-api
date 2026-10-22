# Focused market checks for the attention shortlist

23 October 2026, Australia/Sydney. Continues [158](158-cross-chain-attention-intake.md). No deployment.

## Delivered

- [x] Authenticated POST `/api/10x/admin/discovery/attention/review` selects from the first20 fresh, non-adverse attention leads in the existing global ordering. Among those still lacking a fresh DEX observation, batch the first represented chain and its exact contracts. No symbol joins, chain quotas, arbitrary URLs or additional discovery sources. Selection uses the collecting turn’s bounded saved sample, not a claim of a complete global market ranking.
- [x] Deterministic `attention-review-YYYYMMDDHH` reservation limits focused follow-up to one batch total per UTC hour. Empty and failed results spend that ID; shared admission holds leave it unspent. Concurrent attempts still pass the original atomic reservation. No separate allowance, refund, forced retry or quota reset.
- [x] Local supervised ticks attempt the two core hourly attention sources, then focused review, before ordinary market work. Production cron is unchanged. Operator command `node scripts/discovery-attention.mjs review`, optional exclusive private `--out .tmp/NEW.json`, uses the same hourly admission.
- [x] Replay the queue only from verified saved requests, receipt/body hashes and bounded normalizations. Preserve the original48-receipt/8MB read bound: reserve40 positions for attention lists and8 for DEX receipts in one metadata query. Explicit truncation remains. Market work cannot replace every attention snapshot. This is sampled history, not guaranteed complete24h coverage. A collecting turn replays at most16 attention/4 market receipts (21 reader queries including metadata), leaving database-query capacity for the original reservation/lease/receipt work. The review response discloses selection-history truncation; this is not production serving admission.
- [x] Two-fold or larger differences between fresh DEX and attention-source market cap/liquidity create named review reasons, including zero-versus-positive reports. Unknown values and stale comparisons do not establish disagreement. These coarse thresholds are triage, not calibrated scam classifiers: pool coverage, supply estimates, capture times and real price movement can differ. No automatic rejection or score adoption.
- [x] DEX-selected buy/sell counts now match the selected market provenance. Prefer a fresh GMGN window over stale24h data for current security context; preserve any explicit adverse GMGN flag across retained windows instead of allowing another window to conceal it. Unknown fields remain unknown.
- [x] Existing safe-image policy accepts alternate DEX artwork pointers; no allowlist relaxation, image proxy or inference of successful browser decoding.

## Free budget and limits

Two core hourly sources plus one review imply at most72 scheduled provider attempts/day, compared with48 before this slice. These share the unchanged600 market ceiling and all ordinary market work; this is a workload estimate, not reserved capacity. Existing source/day/research-mode capacity, pause, lease, spacing, provider/reset backoff, timeouts, byte/depth bounds and authentication still decide each admission. Collection of the two core feeds takes priority; no provider retry loop or production schedule is added. Failed review attempts count.

One same-chain batch/hour deliberately bounds cost. It does not refresh all twenty leads or all chains every hour. Other chains and newly reordered leads can wait; freshness/missingness remains visible. At most20 contracts are selected, below the [documented DEX batch maximum](https://docs.dexscreener.com/api/reference). A fresh DEX snapshot corroborates reported markets, not independent attention or organic volume. Pool totals and rolling24h volumes are never added across vendors.

## Dated local result

The first metered review, `attention-review-2026102214`, retained one successful DEX response at01:11:23 Sydney23 October (2026-10-22T14:11:23.464Z). Ten requested Solana tokens matched ten normalized returned rows. The queue remained99 identities; fresh DEX checks covered10, including five of the first ten overall rows. Accepted image pointers increased from19 to25. No two-fold market disagreement or paid DEX boost was present in that dated sample. These absences establish neither organic trading nor safety. All rows remain research review/adverse, with launch selection disabled and evidence gates unchanged.

Private observations: `.tmp/attention-review-20261023-159-001.json`, `.tmp/attention-cache-20261023-159-001.json` and `002.json`. Normal cached reads made zero provider calls. No source quota, backoff, old evidence or original proof was reset. After confirming all control leases and source work idle, the exact supervised launcher was restarted once. Supervisor27208 and every quota/backoff record were retained. The recovered timer invoked the new review route and held its already-spent hourly ID with zero provider calls; automatic local follow-up is active. No production schedule was enabled.

## Verification and remaining work

Backend regressions cover top20 scope, stale/adverse exclusions, once/hour charging including empty and failed replies, shared pause/backoff/market ceiling, tampered receipts, unauthenticated rejection, cross-window adverse preservation, provenance and bounded replay under a flood of market receipts. Existing relay tests cover fixed hosts, chains/contracts, authentication, cancellation and TLS. Discovery UI regressions validate compatible queue rendering. No new UI component or schema is introduced; previous browser artifacts remain historical evidence.

Next:

- [ ] Focus existing candle/security/participation checks on this small queue; distinguish reported volume and holder counts from organic participation. A DEX market check is not wash-trading evidence.
- [ ] Add daily founder labels and explainable meme/catalyst review, then measure shortlist usefulness and false reassurance prospectively across chains. Do not claim quality or market recall from one successful batch.
- [ ] Connect authoritative completed-launch identities when genuinely finalized launch evidence exists. Current content campaigns, simulations and election rehearsals do not qualify; `launch_history_connected=false` and launch selection stays disabled.
- [ ] Optional budgeted FOMOAPI/Birdeye feeds remain key/contract dependent; no paid fallback, new account or scraper in this slice.
- [ ] Preserve independent enabled-performance, accessibility/device/UX, source-bound serving149, security and action/election/financial release acceptance requirements. Existing v4 and first-day action scope are unchanged; broader discovery does not enable cross-chain launches.

Validation:134 backend cases across five suites,164 Discovery UI cases across34 suites,14 relay/operator cases, both scoped typechecks, the closed production build/performance budget, security preflight and thesis-only release guard passed. Original proof row hashes/FK checks and59 frozen private artifacts remain intact. New159 private integrity metadata verifies the original158 outputs and the initial live review receipt; it does not renew earlier evidence.
