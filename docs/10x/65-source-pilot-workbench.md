# Jupiter and GeckoTerminal: offline source review

Follow-up: [combined activity review](66-source-activity-review.md) adds full-inventory file comparison, supplied pool-metadata consistency checks and descriptive organic/candle measurements. Its metadata check does not establish independent canonical proof or change these original v1 reports/hashes. Live transport and access/rights remain unresolved.

Implemented 21 October 2026 from [the Free-source plan](64-free-data-source-comparison.md) and PRD §§4.2/4.7. This milestone prepares the first two sources for validation: typed request plans, bounded response normalization, frozen offline reports and visible readiness. **It does not enable new provider collection, change scores or complete the plan's access/rights preflight.** No deploy.

## Delivered

- [Request/input/report schemas](../../discovery/src/source-pilot-model.ts) and [limits](../../discovery/src/source-pilot-limits.ts): Solana only; ten exact mints per Jupiter batch; up to 360 closed one-minute candles spanning at most six hours; 1 MB input / 1.9 MB frozen record; bounded nesting and processing work.
- [Normalizers](../../discovery/src/source-pilot-normalize.ts) for Jupiter Tokens V2 search, GeckoTerminal public token info and minute pool candles. These are documented-schema candidates, tested with clearly synthetic examples, not authenticated fixtures or certified endpoint coverage.
- [Offline planner, freeze and replay](../../discovery/src/source-pilot.ts). Descriptors contain fixed HTTPS GET routes only. No network transport, credentials, activation argument, database intake or scheduler is implemented. Input, report and domain-separated record hashes are regenerated on replay. “Verified replay” means the same local result was reproduced; source authenticity remains unverified.
- [Local CLI](../../scripts/discovery-source-review.ts): plan, synthetic demo, review, explicit file export and replay. Input reads remain bounded even if a file grows; export refuses existing files and input overwrite. Ordinary output contains normalized fields and hashes, not raw response bodies. Errors use fixed codes rather than echoing input or credentials.
- [Readiness contract](../../discovery/src/source-pilot-readiness.ts) added to the existing local status response and [Data status panel](../../app/src/discovery/SourcePilotPanel.tsx). It says collection is held, describes remaining work and proposed shared-budget limits, and offers no activation control. Older services without the field show unavailable readiness rather than claiming the source is live.

## Normalization and evidence boundaries

### Jupiter

Exact requested mint identities are case-sensitive. Missing rows stay `not_reported`; duplicate target identities are rejected. Unknown/unrequested identities hold the batch rather than hiding a possible conflicting record. An identified row with invalid metrics is held without discarding valid neighbours.

Retain organic score/label, declared holder count, reported price/cap/FDV/liquidity, audit fields, first-pool time and four activity windows. Missing values remain null; explicit zero and false remain distinct. Jupiter metrics require documented numeric types and bounded percentages. Organic volume and net-buyer counts cannot exceed their corresponding reported totals when both are present. Future declared times hold the row; missing/stale update times remain visible. The five-minute timestamp review is local triage, not verified trade freshness.

`numOrganicBuyers` is preserved as **organic net buyers**, not every buyer. First-pool time is not token creation. FDV does not fill missing cap. Provider audit booleans do not become finalized chain proofs. Organic activity, chart strength and our Discovery score remain different constructs; no v4, score blending or new ceiling is introduced.

### GeckoTerminal

Token info requires both `solana_<mint>` and the exact attribute address. Decimal strings are accepted only for the documented numeric surface; blanks, booleans, hex and exponent strings cannot become passing numbers. GT score/breakdown, holder count and top-ten percentage remain third-party observations. The score's observation time is unknown because the token-info contract supplies no timestamp for that score; a holder update time cannot substitute. All these fields are optional measurements, not a promise that the public Free host returns the richer Demo fields.

Candles require positive finite OHLC, nonnegative finite USD volume, valid ranges, integer epoch seconds, minute alignment, strict reverse chronology, exact mint/WSOL orientation and a wholly closed requested window. Reject duplicates, order errors, millisecond times, future/open/out-of-window bars, contradictory ranges and numerical overflow. Do not repair a bad series by sorting or dropping suspicious bars.

The report orders valid output chronologically and explicitly counts missing minutes, including holes at the window edges. No empty interval is filled. An empty result has unknown volume/return, not zero activity. Return and summed reported volume describe only the returned observations; gaps prevent a complete-window claim. No wash verdict or opening market cap is derived.

**Pool limitation:** an OHLCV response does not echo its pool identity. Even a complete valid series retains `pool_identity: request_context_only` and a visible issue. The request plan includes a separate pool metadata read; a future collector must bind that response and the existing canonical on-chain pool proof before using candles as evidence. This milestone does not implement that binding or admit these file results into candidate evidence.

## Run locally without providers

From the repository root:

```powershell
pnpm exec tsx scripts/discovery-source-review.ts plan
pnpm exec tsx scripts/discovery-source-review.ts demo
```

The demo uses [invented test values](../../discovery/src/source-pilot-fixtures.ts) for all three response kinds, labels them `synthetic`, and makes no provider requests or database writes. It is not a GMGN/Jupiter/Gecko assessment of USDF, XTO, Kimchi or any actual token.

For an existing local input file conforming to `source-pilot-input-v1`:

```powershell
pnpm exec tsx scripts/discovery-source-review.ts plan .tmp/pilot-input.json
pnpm exec tsx scripts/discovery-source-review.ts review .tmp/pilot-input.json
pnpm exec tsx scripts/discovery-source-review.ts freeze .tmp/pilot-input.json .tmp/pilot-record.json
pnpm exec tsx scripts/discovery-source-review.ts replay .tmp/pilot-record.json
```

`received_at` is explicit and frozen. Provenance is only `synthetic` or `unverified_file`; there is no accepted `authenticated`/`live` label. These commands read files and do not fetch URLs. Keep raw files private and out of Git, omit credentials/headers, and confirm retention rights before retaining actual provider data. Local file exports are not prospective cohort admission and cannot satisfy the existing research schemas or action/election gates. No provider bodies were captured by this milestone.

Inspect readiness at [the local preview](https://app-local.10x.meme/status#source-pilot), or read `GET http://127.0.0.1:8794/api/10x/system/status` and its `data.source_pilot` field. No migrations, configuration changes, keys or service restart are required when the existing local watcher is running.

## Access and rollout status

Reviewed current [Jupiter token documentation](https://developers.jup.ag/docs/tokens/token-information), its [organic-score explanation](https://developers.jup.ag/blog/what-is-organic-score) and linked [API agreement](https://developers.jup.ag/docs/legal/sdk-api-license-agreement). The agreement remains swap-oriented and restricts comparison, sharing and data combination; no separate Tokens-only grant was established. No new Jupiter account/key or token-data request was made.

Reviewed the [actual public GeckoTerminal Swagger document](https://api.geckoterminal.com/docs/v2/swagger.json), which documents token-info and minute OHLCV routes and their query parameters. Reviewed [GeckoTerminal terms](https://www.geckoterminal.com/terms-conditions), which point API use to separate API terms, and the distinct [CoinGecko Demo token-info](https://docs.coingecko.com/demo/reference/token-info-contract-address) and [candle](https://docs.coingecko.com/demo/reference/pool-ohlcv-contract-address) references. Public versus Demo field entitlements and permitted retained mixed-source research/public exports remain unresolved. No new Gecko token-info/candle data requests were made. Existing ordinary quote collection retains its prior configuration and budget.

The [Workers best-practices reference](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) and current Workers types `5.20261021.1` were reviewed; installed types/dependencies and Wrangler configuration are unchanged. The new Worker status field is a pure read-only projection with no added D1 query.

Remaining sequence:

1. Resolve source-specific rights and actual Free access; collect permitted real exact-mint/pool fixtures. No paid fallback or balance-funded service is selected.
2. Certify schema/units/coverage against real responses, including the missing pool binding. Build a disabled read-only transport only when this preflight permits it.
3. Connect atomic pre-request reservations, pause/backoff/leases, retries, storage admission and fixed-host relay allowlisting. The proposed pilot ceiling is **20 market requests/day inside the existing 600**, not an additional budget; lower actual remaining capacity must hold work.
4. All eventual raw/comparison captures share the original **100 records / 10 MB/day**, three captures and five finalizations per maintenance pass. The workbench reports these future constraints but makes no reservations and claims no remaining capacity. Do not plug it into collection until these checks are connected.
5. Run prospective, matched-cutoff custom/Jupiter/GT comparisons in stages, preserve missing cases and independent controls, then consider a separately versioned scoring proposal. Existing v1–v3 replay, origin/authority/inventory/funding evidence and election/action gates remain intact.

## Validation

Focused source/CLI tests cover no-network operation, fixed request scope, missing versus zero, exact identities, invalid metrics, conflicting denominators, candle gaps/order/time/orientation/ranges, byte/work bounds, safe file IO and tamper replay. Service coverage verifies the readiness read makes no provider calls or quota/candidate writes and that attempted activation returns 404. UI tests verify the held/unavailable states and absence of activation controls.

Completed checks:

- `pnpm --dir discovery typecheck`: passed.
- `pnpm --dir discovery test`: **959 tests / 58 files passed**, including existing scoring and election replay. The first focused source/CLI run passed 41 tests; the full suite includes those and the status integration check.
- `pnpm --dir app typecheck`: passed.
- `pnpm --dir app exec vitest run src/discovery`: **79 tests / 15 files passed**.
- `pnpm --dir app build`: passed; **234.1 KiB gzip across 11 startup chunks**, below the unchanged 250 KiB bound. Existing dependency annotation warnings did not fail the build.
- CLI `plan`/`demo`: passed; three synthetic response kinds replayed with zero provider calls, zero database writes and unverified source authenticity.
- Existing local `system/status`: new readiness field validated; new collection disabled and score/evidence effects absent. Browser QA inspected the panel and expanded limits. The ordinary collector continued reporting source gaps through its existing validation/backoff rather than hiding them.
- Local documentation targets and Git whitespace checks: passed.

No candidate, scorecard, cohort, evidence record or API credential was written by the source pilot. No deploy.
