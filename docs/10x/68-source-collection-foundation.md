# Jupiter/GeckoTerminal collection and trading-data foundation

Implemented 21 October 2026 from PRD §§4.2/4.7. This continues the [source plan](64-free-data-source-comparison.md), [response workbench](65-source-pilot-workbench.md) and [combined candle/activity review](66-source-activity-review.md). This milestone adds the missing collection and accounting layer.

The collection adapter and shared admission are implemented and tested, but **not connected to a route, CLI, relay, timer or scheduler**. No new token-data requests, credentials, paid services or deployment were made. Existing collectors keep their settings and every action/election/evidence gate remains. Current score-v4 is unchanged.

## Completed

- [x] Define one-request, fixed-host GET contracts for Jupiter exact-mint Tokens V2 search and GeckoTerminal public token info, pool metadata, closed one-minute candles and pool trades. Metadata and candles cost separate requests; a batch is one HTTP attempt, not one call per mint. Supplied URLs, auth headers, invalid addresses, duplicate mints and open candle windows are rejected.
- [x] Request Gecko trades with `include_anomalous=true` and the exact mint orientation. Do not use Pro-only pagination/window/row-count parameters or a paid fallback. The public response can contain up to 300 events; retain the cap as a coverage limitation rather than truncating to the older 100-token-row workbench limit.
- [x] Add additive local migration `0041_source_reservations.sql`. Atomically reserve one attempt, one research slot, worst-case 1.9 MB, shared market usage and pacing in a D1 transaction before IO. Any statement failure rolls back the whole reservation.
- [x] Keep the pilot's 20 attempts/day **inside** the configured market allowance, capped at the existing 600/day maximum. Failed and abandoned attempts count. A lower supplied market limit is respected. The ordinary market quota sees pilot usage.
- [x] Make admission symmetric with score research: both paths count cohorts plus source reservations against **100 records / 10 MB per UTC day**. Research's existing `today` usage now includes both. Unfinished/expired reservations keep their full byte charge; completed sanitized receipts reconcile down to their actual JSON payload bytes. There is no HTTP-attempt refund, automatic retry or budget increase.
- [x] Add a transport adapter that requires an explicit fetch dependency and an owned persisted reservation. Claim exactly once; regenerate the URL from the stored, hash-checked request. Reject redirects and non-JSON/oversized/malformed/complex responses, omit cookies/credentials, bound body input to 1 MB and timeout to 15 seconds. Check pause, owner, lease, UTC day and time before fetching and before retaining a result.
- [x] Honor persisted source cooldown, existing discovery backoff and existing market error backoff. Space prepared pilot requests at least ten seconds apart and allow only one unexpired pilot reservation at once. Persist 429/5xx backoff, `Retry-After` and Jupiter exhausted-bucket reset headers; an excessive wait holds rather than shortening the provider's delay. Late/paused results cannot clear a newer backoff or publish data.
- [x] Retain hashed request/parsed-response receipts with fixed sanitized failures. Verify request, payload size, receipt and response hashes on cached read. This is local integrity verification, not independent provider authentication, raw HTTP-byte retention, semantic normalization or canonical chain proof. Failed-response bodies, response headers, locations and upstream exception text are not retained.
- [x] Add separate `source-trades-input-v1` file review, freeze and replay. Bound the selected window to six hours and capture/metadata freshness to five minutes. Validate exact mint/WSOL direction, Solana signature/address shapes, timestamps, decimal-string amounts, finite totals and unique opaque event IDs. Multiple events in one transaction remain separate events.
- [x] Measure sampled buy/sell counts, distinct transactions and source-reported wallets, USD volume, sub-dollar events, largest reported-wallet volume share and vendor anomaly-flag coverage. Missing anomaly flags stay unknown. Older returned events are counted outside the selected window; future events or contradictory directions reject the input. Missing/foreign/inverted pool metadata holds measurements. Zero volume does not become an undefined-ratio pass.
- [x] Preserve original workbench/score artifact formats and hashes. The trade sample does not identify beneficial owners, certify signers, prove a round trip, establish wash trading or reconstruct opening cap. Its provenance stays synthetic/unverified file context. No score component is added or vendor score blended.
- [x] Update read-only readiness and Data status to distinguish the tested foundation from the held collector. Older readiness responses remain accepted; there is no activation button or route.

Implementation: [requests](../../discovery/src/source-collection-request.ts), [atomic admission](../../discovery/src/source-collection-store.ts), [transport and receipts](../../discovery/src/source-collection-transport.ts), [trade review](../../discovery/src/source-trades.ts), [collection checks](../../discovery/src/source-collection.test.ts), [trade checks](../../discovery/src/source-trades.test.ts).

## Free endpoint review

The [current Jupiter rate-limit documentation](https://developers.jup.ag/docs/portal/rate-limits) describes keyless access and an organisation-wide shared bucket; other Jupiter products consume that bucket too. The prepared adapter is keyless and does not obtain a key or assume exclusive account capacity. The [public GeckoTerminal Swagger contract](https://api.geckoterminal.com/docs/v2/swagger.json) currently specifies approximately **10 calls/minute**, subject to fluctuation, one-minute caching and API version `20230203`. Its trade contract marks `per_page`, `cursor` and `trading_period` as Pro-only; including anomalous events is a separate public parameter. Published provider limits do not enlarge our internal budgets or prove field availability for Solana.

The [GeckoTerminal terms](https://www.geckoterminal.com/terms-conditions) refer API use to the [CoinGecko API terms](https://www.coingecko.com/en/api_terms). Their cache refresh/deletion and permitted storage/derivation requirements need reconciliation with immutable research retention, including hashes. The [Jupiter agreement](https://developers.jup.ag/docs/legal/sdk-api-license-agreement) has a limited development/comparison grant alongside swap-oriented definitions and restrictions on other uses and sharing/combining data. No API-specific permission for our full retained, mixed-source scoring/display/export workflow is assumed. The existing preflight remains open; no provider contact or funding was performed.

## Local file review

```powershell
# Existing permitted files only; no network or main-database writes:
pnpm exec tsx scripts/discovery-source-review.ts trades .tmp/trades-input.json
pnpm exec tsx scripts/discovery-source-review.ts trades-freeze .tmp/trades-input.json .tmp/trades-record.json
pnpm exec tsx scripts/discovery-source-review.ts trades-replay .tmp/trades-record.json
```

Input fields: `version: source-trades-input-v1`, `provenance: synthetic|unverified_file`, `address`, `pool`, `start_at`, `cutoff_at`, `received_at`, `pool_metadata: null|{received_at,response}`, and `response` (public `{data:[...]}` trade envelope). Ordinary output contains measurements and hashes; explicit non-overwriting exports include the supplied bodies. Keep actual provider exports private and confirm retention permission first. File-format replay does not consume or substitute for future collector admission.

## Remaining work, in order

- [ ] Close API-specific permitted-use/retention and Free endpoint-access preflight. Verify actual Solana responses, including availability of anomalous trades, coverage of launch minutes and missing fields. Preserve missingness; do not borrow CoinGecko Demo/Pro fields or limits.
- [ ] Bind request receipts and fresh provider metadata to the existing independently verified canonical PumpSwap pool/graduation proof. Metadata consistency is not sufficient to admit derived evidence to scoring.
- [ ] Connect the collector to a bounded, predeclared mint/pool cohort and the existing three-capture maintenance allowance. No duplicate per-provider schedule, retroactive cohort selection, spare quota invention or daily retry loop. Coordinate account-wide rate limits and the existing provider cadence before enabling it. The new adapter is not yet called by production or local maintenance.
- [ ] Collect authorized prospective Jupiter/candle/trade fixtures inside actual spare capacity. Every metadata, info, candle, trade, failure and retry attempt counts separately. Twenty calls do not promise ten bundles. At implementation verification, **all 100 current-day research slots were already occupied**, so no new source reservation was made.
- [ ] Normalize admitted receipts into paired observations, retain every selected token's missing/rejected coverage, and combine trade sample measurements with the existing candle/organic review without conflating pool and token totals.
- [ ] Preregister the actual comparison baseline (**current v4**, archived versions preserved), independently selected controls, common observation times and proposed anomaly thresholds. Test false positives and real forward outcomes before proposing a versioned scoring change. Vendor labels and screenshots are leads, not fraud ground truth. Historical v3 studies remain labelled v3.
- [ ] Continue GMGN only when the founder's independently funded account is qualified and endpoint/retention rights are verified; no additional assets, paid keys or trading permissions.

## Local verification

A consistent SQLite backup preceded local migration 0041. All original **100 score cohorts and zero outcomes** remained byte-identical and foreign keys passed; the new reservation table remained empty. Current-day retained research was 1,752,343 bytes. These are dated observations, not promised future headroom.

- Full discovery suite: **1,076 tests across 63 files passed** with one worker. Final changed-module rerun: **95 tests across four files passed**, including the additional delayed-claim pacing regression. The first parallel run exposed historical migration fixtures that needed direct old-schema seeding and an unchanged election test's five-second timeout under contention; the corrected fixtures and election checks passed without relaxing test timeouts.
- Discovery UI: **81 tests across 15 files passed**; both project typechecks passed.
- App build and performance budget passed: home startup **234.1 KiB gzip across 11 chunks**, under the unchanged 250 KiB limit. Existing dependency annotation warnings do not affect this result.
- OpenAPI regenerated from runtime schemas; documentation check passed **265 local targets across 11 documents**; staged whitespace checks passed.
- Cached loopback status/research/ranking checks passed with zero provider requests. Current v4, disabled launch/voting capabilities and action checks remain; the sampled 71-token ranking still had zero eligible tokens. Browser QA verified the held source panel and prepared-foundation details at the existing local tunnel. No forced refresh, provider credential change or deployment.
