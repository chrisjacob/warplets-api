# GMGN ranked trader participation

21 October 2026 (Australia/Sydney). Continue [authentic daily attention](70-authentic-attention-momentum.md), [GMGN candle coverage](75-gmgn-candle-coverage-and-units.md) and [cached signed acquisition](77-holder-acquisition-evidence.md). Add a bounded trader-level view of reported turnover concentration and two-sided activity. These observations grant no organic-volume, meaningful-growth, wash-trading verdict or score credit. All evidence/action/election gates remain. No deploy.

## Plan and implementation

The [official query reference](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-token/SKILL.md) documents `/v1/market/token_top_traders`, a weight-five read compatible with its Free bucket capacity. The [official CLI](https://github.com/GMGNAI/gmgn-skills/blob/main/src/commands/token.ts) and [HTTP client](https://github.com/GMGNAI/gmgn-skills/blob/main/src/client/OpenApiClient.ts) confirm exact parameters and query-key authentication. Installed CLI 1.6.7 was inspected as a second contract reference; this application continues to use its existing metered transport rather than issuing unaccounted CLI queries.

The [request descriptor](../../discovery/src/gmgn-request.ts) permits one fixed Solana query: **100 rows, `order_by=buy_volume_cur`, descending, no tag filter**. No cursor, pagination, caller-provided URL, alternate sorting or chain. The existing IPv4 [bridge](../../scripts/discovery-gmgn-relay.mjs) enforces the same parameter allowlist. Authentication remains query-key only; no private key, signer or trading endpoint.

This endpoint is **explicit operator review only**. The existing three-mint, 21-attempt scheduled pilot and three-capture maintenance allowance are unchanged. Every attempt uses the existing atomic source reservation, one shared market HTTP slot, shared research admission/bytes, ten-second spacing, one in-flight request, owned lease, pause and persistent provider backoff. No additional daily allowance or retry loop. The readiness report now accurately describes the maximum supported request weight as five and its theoretical daily weight envelope; this is metadata, not an increased HTTP or provider rate allowance. Local calibration keeps its existing explicit admission semantics; production restoration is still required.

## Measurement contract

The [normalizer](../../discovery/src/gmgn-traders.ts) accepts the documented `data.list` with at most 100 unique valid wallet addresses. Duplicate/malformed addresses, malformed/negative/nonfinite decimals, unsafe counts, overflow and oversized samples fail the response rather than dropping inconvenient rows. Missing scalar fields remain unknown. Attacker-controlled names, tags, social content and instructions do not enter the aggregate measurements.

Only rows labelled regular wallets (`addr_type=0`) enter participation denominators. Exchange/pool rows (`2`) and missing/unrecognized types are separately counted and excluded. These are provider labels, not independent account-type verification.

| Measurement | Denominator / limit |
|---|---|
| Reported buy and sell USD; combined flow | Returned regular-wallet rows with **both** volume fields. Rows missing either field are counted separately; no observed rows means null, whereas measured zero stays zero |
| Largest and top-five wallet flow shares | Sum of buy + sell USD across those complete rows. Positive denominator required; five largest combined flows are selected within the returned buy-ranked sample |
| Two-sided rows and smaller-leg sum | Rows with both positive buy/sell USD. Sum `min(buy USD, sell USD)` once per row; this does not match actual trades or counterparties |
| Reported buy/sell transaction counts | Separately measured rows with **both** safe integer count fields, with their own row denominator |

The aggregate period is **unknown**: exact window start/end are null. Never call these 24h/since-creation totals, align them to candle windows, compare their sum with daily volume, infer trade ordering or use them to qualify holder acquisition. Buy-ranked selection can omit sell-heavy and small traders. The 100-row cap is explicit even when fewer rows return; neither case establishes full population coverage. Beneficial independence, canonical pool scope and provider measurement time remain unknown.

Two-sided activity and concentration can support investigation; ordinary traders also buy and sell. A smaller-leg sum is not proven matched turnover, a circular flow, a wash estimate or a scam verdict. No threshold or automatic fraud label is activated. A missing/false vendor flag is still not a clean pass. Qualified 24h volume and meaningful holder growth remain null; current score-v4, earlier versions and frozen cohorts are unchanged.

## API, UI and private replay

The existing public `GET /api/10x/gmgn/solana/:mint` adds an optional/default-null `trader_sample` aggregate. Legacy summaries remain readable. Only saved evidence is read; opening the UI cannot query GMGN. The existing **GMGN activity & risk evidence** panel shows row coverage, sample USD flows, concentration and two-sided amounts beside an explicit unknown-period boundary. No new public wallet list or collection control.

Authenticated saved reviews additionally provide a trader-only replay record with original request, complete source receipt, receipt hash and normalized-report hash. The [offline replayer](../../discovery/src/gmgn-trader-replay.ts) checks the complete original receipt hash before parsed selected fields, request/response hashes, successful retained research permission, receipt chronology and recomputed report hash. Hash consistency does not independently authenticate the provider.

Repository-root commands:

```powershell
node scripts/discovery-gmgn.mjs status
node scripts/discovery-gmgn.mjs review MINT traders
pnpm exec tsx scripts/discovery-gmgn-traders.ts freeze REQUEST_UUID
pnpm exec tsx scripts/discovery-gmgn-traders.ts replay FILE
```

The [export tool](../../scripts/discovery-gmgn-traders.ts) uses a fixed authenticated loopback cache GET, manual redirects, a 30-second timeout, bounded streams and a unique ignored `.tmp` file created without overwrite. Replay checks a bounded regular file, loads no credentials and makes no network request. Source response remains bounded to 1 MB, source receipt to the existing 1.9 MB reservation and replay input/export to 2 MB. No migration or archive deletion policy is added.

## Completed and remaining

- [x] Fixed weight-five query, existing shared admission/backoff and bridge restrictions.
- [x] Strict bounded aggregate measurements with separate denominators, missingness, selection bias and unknown period.
- [x] Cache-only public presentation, authenticated private evidence and offline replay/tamper checks.
- [ ] Independently corroborate actual transaction-level activity, time boundaries, canonical scope and wallet relationships before qualifying volume or acquisition.
- [ ] Obtain representative prospective ordinary-launch and manipulation controls; calibrate attention transformations and propose an explicit new scoring version only after review.
- [ ] Complete real 24h/creation-boundary meaningful growth, retention/economic rules, source readiness, archive policy and production admission restoration. No release/financial authority is added.

## Live evidence and validation

One explicit PONYX request succeeded with HTTP 200, received **09:21:05.543 UTC**, reservation **`119ed5d0-f9d7-4620-aaae-fecd3485736a`**. It consumed **one** existing market/source HTTP attempt (provider weight five); no retry or additional collection schedule. All 100 returned rows were reported regular wallets with both USD fields and both transaction counts. The row cap was reached; population coverage remains unknown.

| PONYX sample measurement | Result |
|---|---|
| Reported buy / sell USD | $137,169.55 / $13,677.54 |
| Reported combined buy + sell flow | $150,847.08 |
| Largest / top-five combined-flow share | 69.6862% / 89.4909% |
| Two-sided rows | 26 / 100 |
| Sum of each row's smaller USD leg | $13,670.98 |
| Reported buy / sell transactions | 750 / 574 |

These are **period-unknown, buy-ranked sample aggregates**, not daily organic totals or a verdict about those wallets. They do not establish chronology, wash volume, independent counterparties or genuine participation. PONYX's current score remains governed by v4's existing inputs and adverse ceilings.

Private freeze and offline replay verified receipt hash **`514ed83a79c853aa2b22477ef670590a18ba9625d5c87f92d42cf9d86f367ac8`** and normalized report hash **`449d50640567c8d103ce1d974c3452e2c13b92c137d39f4580582cb3ef7e8c4c`**, with zero provider requests or database writes during export/replay. Live data can change on a later explicit request; the artifact retains its original receipt and selection.

- **90 backend tests** passed across traders, existing GMGN integration/window replay and shared source collection. The final thirteen trader tests passed again after export/replay was added. Cases cover unknown/missing/zero/partial denominators, pool/unclassified rows, duplicate/malformed data, overflow, fixed query/weight, source hash corruption, cache-only reads and admission/backoff. Old candle semantics and the scheduled pilot remain covered.
- **97 Discovery UI tests across eighteen files** and **seven operator/bridge tests** passed. The new UI check covers unknown aggregate periods, missing-versus-zero flows, denominator wording and legacy default-null summaries. The bridge rejects broadened limits, sorts, filters, duplicate query keys and pagination.
- Discovery/app typechecks, regenerated OpenAPI, app build and performance budget passed. Startup remains **234.1 KiB gzip across eleven chunks**. Existing dependency annotation warnings remain non-fatal.
- Local browser QA verified the actual PONYX concentration, row cap, denominators and unknown-period wording. Screenshot: `.tmp/gmgn-traders-ponyx.png`. One guarded owned launcher restart loaded the bridge allowlist through the original supervisor; restart capacity and local stores were preserved. User browser tabs were left untouched.
- Read-only streaming digests confirmed all **172 original cohorts, zero outcomes, 34 completed source receipts, 780 holder receipts and 71 wallet receipts** unchanged. Foreign keys passed. The one newly retained trader receipt is additional metered research; normal collection continues independently. No migration, archival rewrite or quota reset.
- All **426 local Markdown targets across 22 documents** resolved and whitespace checks passed. Actual query-key/build scans and secret-file exclusion checks passed. Unrelated Network/legal work remains excluded from this milestone. No deploy.

Commands: `pnpm --dir discovery test src/gmgn-traders.test.ts src/gmgn.test.ts src/gmgn-window.test.ts src/source-collection.test.ts --testTimeout=30000 --maxWorkers=1`; final trader-only rerun; `pnpm --dir discovery exec tsc --noEmit`; `pnpm --dir app test src/discovery`; `node --test scripts/discovery-gmgn-relay.test.mjs scripts/discovery-gmgn.test.mjs`; `pnpm --dir app build`; `pnpm exec tsx scripts/generate-discovery-openapi.ts`; metered review/private freeze/offline replay above. Ignored local helpers checked immutable-row digests, credentials and documentation targets.
