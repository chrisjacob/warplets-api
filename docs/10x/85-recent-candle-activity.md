# Recent activity from saved candle windows

21 October 2026. F3 continuation of the [daily product plan](82-next-product-functionality-plan.md) and [common activity comparison](84-common-activity-and-token-comparison.md). Current score-v4, every evidence/action/election gate, provider Free limits and no deploy remain.

## Measurement policy fixed before outcome review

`recent-candle-policy-v1` is an experimental descriptive policy, fixed in code before reviewing new token outcomes. It has no score weights, pass/fail trust threshold or model promotion authority. Its full JSON checksum accompanies each report. Changes require a new policy version; never rewrite a prior display artifact or score cohort.

- Anchor all periods to the saved six-hour request's exact closed-minute endpoint, not the browser time or the last available candle. Show that endpoint and freshness prominently. Never slide a missing final minute out of the denominator.
- Measure the last 5, 60 and 360 minutes. Compare 5 minutes with its preceding 5 minutes, and 60 with its preceding 60. The preceding six hours are outside the retained request and remain unknown. No annualization, hourly-to-daily extrapolation or assumed creation baseline.
- Require every closed minute at its exact timestamp for a period's price or volume values. Missing/conflicting overlap minutes withhold that entire interval. A complete short period can remain descriptive when a different part of the six-hour request is incomplete.
- Price change is the first open to the last close, in percent. Values must be finite. Price movement does not prove demand, manipulation or safety.
- USD volume uses the existing price-dimensional GMGN unit corroboration (at least twelve informative candles, no contradictory pairs), plus both reported flow fields present on every target candle. This remains a same-provider report, without canonical-pool, independent-trade, fee, valuation-history or organic-demand certification. Count positive-volume minutes only under the same unit/coverage requirements; this is not trader breadth.
- The volume ratio is recent reported USD divided by the equal-duration preceding reported USD. Both periods must qualify descriptively and the preceding total must exceed zero. A zero baseline yields unknown, never infinity or an arbitrary maximum. A complete recent zero with a positive baseline legitimately yields zero.
- More than five minutes between source receipt times holds all measurements. A period that starts before verified creation is held. Future receipts/endpoints are rejected. A missing receipt is missing, not zero.
- Freshness requires both the candle endpoint and fetch time within 180 seconds of the common review cutoff. Stale saved values may remain visible with their actual dates and a stale label; they are not current momentum. Unknown/future dates cannot become fresh.
- Organic volume, meaningful holder growth, trader breadth, beneficial independence and qualified attention momentum remain unknown. No score, rank, action or election credit. No chart-derived fraud verdict.

## Product and compatibility

The existing cache-only comparison adds an optional, independently versioned `recent_activity` report per available saved candidate. Its original thirteen activity slots, v1 comparison envelope, legacy display checksums and score-v4 evaluator remain intact. Older comparisons without the optional field continue to verify. The new report and its policy are checked before display, including mint, mode and common-cutoff binding. Checksums establish display/archive integrity, not upstream truth or a full private replay.

The UI shows recent 5m/1h/6h rows with reported USD, price change, closed-minute denominator, equal-period volume ratio, actual source dates and freshness. Details retain prior-period coverage, unit/receipt limitations and original source references. Fixture mode stays simulation. Missing/rejected sources and absent mints remain visible; they do not trigger provider collection.

The source assembly exposes its already-normalized bars internally for the new read model. The existing archived candle report and hash are preserved byte-for-byte. Common activity and recent periods reuse one cached candle read; no extra provider request, timer, migration, storage row or allowance is added. A new measurement failure is isolated from the old candle observations.

## Verification and remaining work

- Backend: 109 targeted tests passed across recent periods, common comparison, archived candle windows, GMGN source/activity receipts, holder history, current v4 and request security. Cases cover complete/partial/overlap-conflicting windows, missing flow pairs, reversed unit fields, stale/future data, young launches, zero denominators, fading activity, receipt skew, identity/checksum corruption, legacy compatibility and zero provider IO/database writes.
- UI: 115 discovery tests passed. Backend and application typechecks and the application build passed. Home startup remains 234.1 KiB gzip across eleven chunks.
- Existing evidence preservation passed: all original hashes for 177 score cohorts, zero outcomes, 39 completed source receipts, 830 holder inventories, 72 wallet observations and 595 transaction-cache rows remained identical. Foreign keys passed; ordinary background appends are allowed.
- Real cache smoke: `.tmp/recent-activity-live-a3073e03-59ce-4e87-a05d-6414f9b31668.json`, cutoff `2026-10-21T12:08:36.907Z`, comparison checksum `e3b1d004e97506ebfea369c2ad10278efeba1524daf4b3f6f88bef2f89f00367`. A saved token with candles had complete 5/60/360-minute periods anchored at `08:20Z` and correctly labelled stale; the other saved token had no candles and remained missing. Qualified attention stayed null. The read used zero provider requests and database writes. This checks a general product projection, not a new token verdict or outcome study.
- Browser verification succeeded at the shared `2026-10-21T12:12:52Z` cutoff after normal owned preview recovery. All three recent periods, exact dates/denominators and stale labels rendered; screenshot `.tmp/discovery-recent-activity.png`. The existing intermittent local transport issue remains F5 work; no restart-budget bypass or runtime fix is claimed.
- The previously frozen real three-token v1 comparison still verifies unchanged with checksum `48f4446cebe1b23dd5752e4febacbcffd4a6bc5be27360ee68a02772d42d27a7`, without the optional recent-activity field.
- The policy checksum is `acaba3176ab02f79f5256c92ff3f929cb2b72e627738b593561caf54baef848e`. No policy threshold or scoring weight was fitted to these cached results.

This completes only the recent-candle measurement slice of F3. Meaningful acquisition/retention and organic-volume qualification still require preregistered economic-size, provenance, independence, coverage and valuation rules plus prospective evidence. Broad admitted rotation, the later-day scoring holdout and F5 runtime/storage reliability remain open. No new GMGN market-feed entitlement or scoring improvement is claimed. No deploy.
