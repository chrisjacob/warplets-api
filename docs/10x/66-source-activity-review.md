# Jupiter and GeckoTerminal: combined activity review

Implemented 21 October 2026 from PRD §§4.2/4.7 and the [Free-source plan](64-free-data-source-comparison.md), following the [individual-response workbench](65-source-pilot-workbench.md). This adds a reproducible offline review of the same selected mint inventory, provider activity and pool candles. It prepares source comparison while GMGN qualification is pending. No new provider collection, score policy, credential, database intake or deployment is enabled.

## Completed checklist

- [x] Add a strict manifest with an explicitly selected ordered cohort, exact case-sensitive mint/pool identities, selection time and common cutoff. Keep every selected token in the report, including absent, unreported and rejected sources.
- [x] Reuse the existing source-v1 normalizers and record hashes. Accept at most ten mints and 21 supplied source inputs, within the unchanged combined 1 MB input / 1.9 MB record and nesting/work bounds. These are file-format ceilings, not promised daily collection capacity.
- [x] Reject foreign requests/pools, duplicate source slots, duplicate mints/pools, mixed synthetic/file provenance and injected transport/chain-proof claims. No last-response-wins selection.
- [x] Restrict supplied capture times to the five minutes through the cutoff and after declared selection. Require candles to end at the cutoff's last closed minute. Judge Jupiter update age at the cutoff as well as its original receipt time.
- [x] Check supplied Gecko pool metadata against exact `solana_<pool>`, attribute address and mint/WSOL token relationships. Missing, malformed or contradictory metadata holds derived candle measurements. Even consistent metadata remains unverified file context: canonical chain proof is explicitly `not_checked` and the candle source-v1 receipt still says its pool was not echoed.
- [x] Measure Jupiter buy/sell organic-volume percentages independently. Preserve zero, missing and undefined ratios; zero denominator or a contradictory part/total yields null. Keep organic **net** buyers distinct from all buyers and retain the reported trader/net-buyer counts. Stale, absent or future update times hold the derived organic summary.
- [x] Measure observed candle coverage, adjacent close moves, rising-pair proportion/longest run, observed close drawdown, moving bars at zero reported volume and the top-two share of positive adjacent log moves. A gap cannot become a one-minute jump or join two rising runs. A flat OHLC bar can still have an adjacent close jump; missing predecessor minutes cannot establish that jump.
- [x] Keep Jupiter organic score and GT Score separate. GT score time remains unknown; capture-window alignment does not establish synchronized provider measurements. Token-wide activity and a single pool's USD candle volume are explicitly not comparable totals. There is no averaged score, fraud threshold or custom-v3 validation result.
- [x] Freeze raw inputs, normalized measurements, component source references/times and domain-separated hashes; recompute everything on replay. Hash consistency authenticates neither a provider nor the claimed selection time.
- [x] Add CLI comparison, explicit non-overwriting export, replay and an invented demonstration with an uncovered control. Ordinary output contains normalized fields and references, not raw provider metadata. No network, key, D1 binding or activation argument exists.

Implementation: [review and manifest](../../discovery/src/source-pilot-activity.ts), [invented example](../../discovery/src/source-pilot-activity-fixtures.ts), [adversarial checks](../../discovery/src/source-pilot-activity.test.ts) and [file CLI](../../scripts/discovery-source-review.ts).

## Run locally

```powershell
pnpm exec tsx scripts/discovery-source-review.ts compare-demo
# Existing permitted local files only:
pnpm exec tsx scripts/discovery-source-review.ts compare .tmp/activity-input.json
pnpm exec tsx scripts/discovery-source-review.ts compare-freeze .tmp/activity-input.json .tmp/activity-record.json
pnpm exec tsx scripts/discovery-source-review.ts compare-replay .tmp/activity-record.json
```

The input version is `source-activity-input-v1`. Top-level fields are `provenance` (`synthetic` or `unverified_file`), `selected_at`, `cutoff_at`, `cohort` and `sources`. Each cohort entry contains `address`, `pool` and `pool_metadata` (null, or `{received_at, response}`). `sources` contains existing `source-pilot-input-v1` objects. No source is required to be present: absence is a retained coverage result. The [synthetic fixture constructor](../../discovery/src/source-pilot-activity-fixtures.ts) is the complete executable example.

The demonstration is invented and says so. Its two selected mints produce one available descriptive bundle and one uncovered control; neither represents USDF, XTO, Kimchi or any actual token. `descriptive_bundle_available` means the selected fields and complete closed candles are present in these files. It does not certify safety, source authenticity, canonical-pool proof, synchronized score observation or prospective validation. A favourable GT score never clears missing/adverse activity evidence. `combined_score` and opening market cap remain null; wash trading remains `not_established`.

Exports include raw supplied bodies for reproducibility. Keep files private and out of Git, omit secrets and confirm retention rights before supplying actual provider data. The workbench makes zero provider requests and zero database writes; it does not reserve or bypass a research admission slot. Grouping observations into one file must never collapse their individual future source/research accounting.

## Remaining checklist

- [ ] Resolve the exact Tokens-only Jupiter and legacy-public GeckoTerminal usage/access contracts; verify no-cost endpoint and field availability. Current documentation review does not establish a new data-use grant.
- [ ] Collect permitted real fixtures for known development cases and independently selected controls, then certify schemas, orientation, units, timing and missingness.
- [ ] Bind authenticated request/response provenance and exact pool metadata to the existing independent canonical pool/graduation proof. The new file consistency check completes only one part of that obligation.
- [ ] Connect fixed-host read-only transport, pause/backoff/leases, atomic pre-request reservations and raw/comparison storage admission. No collection activation exists yet.
- [ ] Keep the proposed **20 requests/day inside 600**, counting pool metadata, token info, candles, batches, failures and retries. Ten format-supported mints do not imply ten daily bundles: even one Jupiter batch plus six complete Gecko bundles would cost 19 HTTP calls before retries and may exceed actual spare capacity.
- [ ] Count all future raw/comparison records within the original **100 records / 10 MB/day**, three captures and five finalizations per maintenance pass. Work that does not fit must hold, without trimming the predeclared cohort or overwriting prior evidence.
- [ ] Add a frozen custom-v3 baseline and provider observations collected prospectively at a matched cutoff; obtain independent later outcomes and a held-out time split before proposing score-v4. This descriptive file review does not complete that experiment.

Original v1–v3 score/election replay, current scores, eligibility/action gates, source allowances, schedules and financial authority remain unchanged. No paid services, further GMGN funding or API activation are performed. The founder reports independently transferring $105 to GMGN and waiting for the hourly balance refresh; qualification remains unverified and is not needed for this milestone.

Schema references reviewed 21 October: [Jupiter token documentation](https://developers.jup.ag/docs/tokens/token-information), [linked API agreement](https://developers.jup.ag/docs/legal/sdk-api-license-agreement), [GeckoTerminal public OpenAPI](https://api.geckoterminal.com/docs/v2/swagger.json) and the distinct [CoinGecko Demo pool reference](https://docs.coingecko.com/demo/reference/pool-address). Demo field examples do not establish legacy-public entitlements. No token-data endpoint was queried for this milestone.

## Validation

The focused source/CLI suite passed **77 tests across three files**, including missing controls, contradictory metadata, stale/future cutoffs, unsafe numeric ratios, candle holes, zero-volume jumps, overflow, file overwrite and tamper rejection. The earlier individual-response v1 suite remains unchanged. The full discovery suite passed **995 tests across 59 files**, including existing scoring/election/evidence replay. Discovery typecheck passed. Both CLI demos replayed successfully without network or database access; the original three v1 example hashes remain unchanged by this extension. Documentation targets and Git whitespace checks passed.

The existing Discovery service and Vite preview both returned HTTP 200 from cache/read-only requests; no collector restart or forced refresh was needed. No UI or Worker route changed, so frontend bundles and their previous performance result were not regenerated for this CLI-only milestone.
