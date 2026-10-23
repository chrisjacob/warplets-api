# Fair attention follow-ups for older and lower-position runners

23 October 2026, Australia/Sydney. Continues [178](178-attention-intake-workflow-status.md). No deploy.

## Finding and delivered change

A read-only current snapshot returned 100 attention identities, including 34 fresh Solana tokens. Eighteen Solana entries had a reported opening time more than 24 hours earlier; none had a fresh DEX cross-check. Only two matched retained candidate records. These are returned-view counts, not market population or proof of token age/quality. The independent canonical-admission gap remains.

The source scheduler had a concrete coverage defect: it took the first 20 rows of the combined multi-chain queue before choosing a DEX chain, and candle/trader selection also capped that global list before filtering Solana. Repeated leading chains/tokens could consume attention while lower-position and older Solana runners never reached trading-data follow-up.

- [x] Add versioned attention-fair-followup-v1 scheduling over the existing at-most-100 returned rows. Select the least-recently-attempted eligible chain, then its least-recently-attempted tokens, retaining original source order for ties. Batch at most 20 exact identities from one chain. Age has no maximum in this attention selection; symbols are never identity keys.
- [x] Use at most 25 original cross-check reservations from the preceding 24 hours, including failed, empty and unfinished attempts. Read one bounded metadata query; never transfer a request over 5,000 UTF-8 bytes. Validate original request kind, canonical chain/addresses, bounds and timestamps. Future or corrupt metadata holds selection. Attempt history schedules work only; it supplies no quality evidence.
- [x] Select candle/trader follow-ups from all returned eligible Solana rows, after applying unchanged fresh-attention, provider-adverse, market-cross-check and existing-review checks. Prefer unseen/least-recently-attempted eligible mints with original rank as tie-break. A token below global position 20 can now receive its existing hourly trading-data opportunity, including older runners.
- [x] Preserve the original fixed hourly reservation identities, one DEX batch/one candle/one trader request per hour, shared admission/lease/pacing/backoff, spent jobs, provider/global quotas, source contracts, receipt/history/read bounds and proof/scoring/action gates. No fallback request, cap increase, reset, automatic retry of a spent hour, extra timer or new provider exists. Previously unused hourly slots may become usable, so actual usage can increase within the same ceilings.
- [x] Keep existing attention ordering, grade versions, frozen personal/cohort evidence and launch eligibility unchanged. This fixes evidence acquisition; inclusion in a follow-up batch is not a safe-token label, successful migration admission or organic-volume/holder credit. No new UI panel or migration.

## Historical selection comparison

A private consistent read-only SQLite transaction replayed 12 hourly cutoffs, from 22 October 15:00 UTC through 23 October 02:00 UTC. Both policies received identical historically observed bounded review views. The fair policy began with prior original attempt metadata and carried its own simulated hourly selections forward. Original failed reservations were not reopened. The old policy was replayed exactly as its global-top20/first-pending-chain rule.

| Counterfactual target exposure | Old rule | Fair rule |
|---|---:|---:|
| Planned request opportunities used | 12 | 12 |
| Target observations | 56 | 206 |
| Distinct chain/contract identities | 30 | 125 |
| Distinct identities with positive reported opening time over 24h ago | 13 | 76 |
| Distinct identities with unknown opening time | 5 | 18 |
| Older Solana identities | 6 | 27 |
| Largest batch | 10 | 20 |

The maximum allowed batch remains 20. Distinct-chain counts were Solana 16→51, Base 1→10, BSC 4→27 and Robinhood 9→37. Input SHA-256: 3095980424a0ef9b9482dadc6b7242472f72a0d0df958a2718539588904e9929. Result SHA-256: 5982f52d54af7d3d5bd808bc9820234f4de3aa37285eccf8f9509c63c41a4ebd. Both independently pinned private files replayed exactly in a second process without database/provider access; the exact source policy is retained before commit. Local pins protect artifact integrity, not independent provider truth.

Provider opening timestamp 0 is classified as unknown in this corrected v2 study, not as an old token. The earlier private v1 age tally and first integrity manifest are retained as superseded; original inputs, selections, non-age counts and all source/proof records are unchanged. Scheduling is age-neutral and does not use this classification.

This is a counterfactual selection/coverage comparison, not a trading backtest or evidence of better tokens. No unobserved cross-check response, canonical migration, candle/trader/holder result, organic activity, price outcome or quality label was imputed. Both policies used the historically observed market-cross-check flags; a live alternative would have different later observations. Provider-reported opening time may describe a pool and is not verified creation or graduation age. Returned views are truncated and completed-ATTN exclusion remains disconnected. No provider request or database write was made by this replay.

## Verification and next build order

The focused source/scheduling suite passed 39 tests, including six new fairness/integration cases. Tests cover multi-chain head crowding, within-chain rotation, older targets beyond position 20, exact chain/contract identity, stale/adverse/cross-check exclusions, failed-attempt accounting, metadata corruption/future inputs, unchanged charges, source backoff and spent-hour denial. The full backend suite passed 1,638 tests / 113 suites; both typechecks, closed build/performance budget (227.8 KiB gzip / 11 startup chunks), security preflight and thesis-only release guard passed. Historical proof/FK preservation, private artifact hashes and credential exclusion are recorded in the final integrity manifest. There is no UI change or production CPU/combined Free-serving acceptance claim. Current Workers guidance and published declarations 5.20261023.1 were checked without dependency/configuration upgrades.

1. Measure ordinary unspent hourly allocations: per-chain/age coverage, successful cross-checks, usable candles/traders, failures, costs and unknowns. Do not force a spent hour or claim this replay already produced those observations.
2. Improve canonical intake for older/different-protocol attention runners using separately versioned research admission, exact pool/origin/migration/state proof and existing Free controls. The legacy 24-hour intake/creation screens are unchanged here; an old attention lead must not become an eligible launch by bypassing them. Avoid repeated deep investigation of the same named examples.
3. Qualify meaningful volume/holder acquisition and retention, then measure real prospective founder usefulness and mature independent outcomes before changing grade weights. Preserve unsupported, missing and adverse members in evaluation denominators.
4. Complete authoritative already-launched ATTN exclusions and the practical daily curated shortlist. Finish [149's Free-serving acceptance](149-native-builder-and-combined-free-budget.md) and named recovery/security blockers before release. Further bespoke status panels/labs are not the default next feature.

All evidence and financial/action gates remain. Production stays thesis-only. No deploy.
