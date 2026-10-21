# Local calibration admission and immediate GMGN candle verification

21 October 2026 (Australia/Sydney). The founder explicitly requested disabling restrictive internal research admission while building and calibrating, retaining provider Free limits and every evidence gate. This supersedes the local 120-record hold described in [the candle correction](73-gmgn-candle-contract-and-review.md).

## Mode and exact scope

The checked-in **local-only** Wrangler config now sets `TENX_RESEARCH_MODE=local_calibration`. The [resolver](../../discovery/src/research-limits.ts) enables it only when `TENX_LOCAL_ONLY` is also exactly `true`. Missing, invalid, bounded or non-local configuration restores bounded admission by default.

In local calibration, the daily aggregate **record count**, **retained/reserved bytes** and separate **twenty source HTTP attempts** research subset are uncapped. This is an explicit disabled policy, represented by `null` in atomic SQL admission and status, rather than a giant fake limit or Infinity. The research UI says **uncapped locally** and explains restoration before production. Historical 100/120-record responses still parse; mixed bounded/uncapped record-byte limits are rejected.

Both score publication and source reservation use the same selected mode; GMGN readiness, operator admission, maintenance captures and research summaries receive it from server configuration. A visitor cannot select a mode in a URL or request body. Existing counters and old rows are retained; switching back to bounded mode applies the original limits immediately against actual current usage. No migration, deletion, regrading or quota refund.

Unchanged:

- Configured market allowance, at most **600/day** for GMGN and research sources, shared with existing market collection; lower configured values still win. RPC/quality/wallet provider budgets are unchanged. Standard minute-candle reads cost weight two; no Pro resolution or paid fallback.
- Ten-second source spacing, one in-flight request, owned lease, timeout, provider backoff including 429/reset headers, pause and idempotency. Failed/abandoned attempts still count against provider usage. Local calibration does not restore provider quota.
- Per-response **1 MB**, per-record/reservation **1.9 MB**, candle count/window, strict fields, finite values, OHLC/time/mint/pool checks, unknown semantics, replay hashes, finality and independent evidence requirements. These bounds protect usable evidence and bounded execution.
- Three capture attempts per maintenance pass with at most one allocated GMGN attempt, five score finalizations, existing timer and preregistered daily pilot inventory. No additional per-visitor collection, timer or automatic retry loop.
- Current score-v4, source freshness, eligibility/election/action gates and all financial authority. No signing, funding, trades, launches or deployment.

The held Jupiter/GeckoTerminal readiness panel continues to describe its **proposed bounded pilot**, without activating either provider. Active research admission is reported separately by the research summary and authenticated GMGN status.

## Required restoration before production

- Set `TENX_RESEARCH_MODE=bounded` or remove the calibration setting; do not copy the local configuration into production.
- Verify **120 aggregate records / 10 MB / 20 source attempts** and the configured provider budgets, with contention and exhaustion tests. Review these internal defaults separately if a production capacity decision is needed.
- Confirm status/UI report numeric bounded limits, actual counters are not reset and provider backoff remains honored.
- Preserve calibration receipts and prospective cohorts. Complete the existing rights, canonical binding, coverage, independent validation and release gates before any score adoption or production activation.

This is a tracked release prerequisite, not permission to deploy. Non-local/missing configuration already selects bounded mode.

## Live verification and validation

An ordinary authenticated PONYX one-minute candle request was admitted through the existing IPv4 path at **18:30:55 Sydney time**. Receipt **`23104266-d287-41b5-b070-9f9cf815e63f`** returned HTTP **200**, passed v2 normalization and was retained. Cached replay verified the saved hashes with **zero additional provider requests**.

The real response uses **millisecond timestamps** and returned **100 candles**, while the requested six-hour window (`01:30–07:30 UTC`) expected **360**. Correction from retained timestamps in [milestone 75](75-gmgn-candle-coverage-and-units.md): the returned bars cover `05:50–07:29 UTC`; the initial prose incorrectly inferred their positions from the requested start. The parser accepts up to 360; this count is what the provider supplied, not the former internal research cap. Coverage remains **incomplete**. No pagination behavior or full-window availability is inferred from this one response.

Measured: 99 adjacent pairs, 62 rising pairs, longest rising run eight, 65 alternating-body pairs, no adjacent doubling/halving and no price-moving candles with both flow fields explicitly zero. None of the present descriptive review triggers fired. **This does not establish clean trading or refute the founder's earlier manipulation concern.** Volume units, organic activity and canonical pool scope remain unverified; current score-v4 and all action gates are unchanged.

Validation:

- **130 Discovery tests across six affected files passed**, covering admission beyond both aggregate caps, source attempt 21, original row preservation, default bounded admission, exact local-only selection, provider exhaustion/pause/backoff and candle/replay boundaries.
- **87 UI tests across sixteen files passed**; the final mixed-mode assertion was additionally verified by all eight ScoreResearch tests. **Seven launcher/migration tests passed**, including pending/ambiguous-store fallback and lifecycle cleanup.
- Discovery typecheck, regenerated Wrangler types/OpenAPI, app typecheck/build and performance budget passed. Home startup remains **234.1 KiB gzip across eleven chunks**.
- Real cached research verification passed beyond 120 records; actual counters continue to increase with normal captures. The preservation checkpoint's **116 cohorts, zero outcomes and seven completed receipts** stayed byte-identical; new captures/receipts are additions. Foreign keys passed. No counter reset or historical rewrite.
- The live browser evidence panel showed the real hundred-candle partial window and exact measurements, with unknown USD turnover and no clean-trading assertion. The actual query key was absent from **twenty-nine changed task files and seventy-two built assets**; both secret files remain ignored/untracked. All **383 local Markdown targets across eighteen documents** resolved; whitespace checks passed.

The config reload exposed a local boot problem: Wrangler's no-op migration command reported all migrations applied, then took too long to exit for the existing watchdog. The [launcher](../../scripts/dev-discovery.mjs) now uses a [read-only migration-ledger fast path](../../scripts/discovery-migration-state.mjs) for a single unambiguous local D1 store with every migration filename recorded. The actual local ledger has all forty-two migrations. Missing, pending, unreadable or ambiguous stores still use the original Wrangler migration command. No migration row, schema or watchdog allowance is changed. Regression verifies pending/ambiguous fallback and byte-identical read-only access; the existing launcher lifecycle tests also pass.

A separate Wrangler 4.126.0 **ProxyWorker** error exited the dev Worker during later browser QA. Its cause remains unresolved; the migration fast path is not claimed to fix that runtime error. The existing three-start/fifteen-minute restart circuit and watchdog remained intact. Automatic recovery subsequently returned **HTTP 200 with 69 schema-validated cards**, and **HTTP 200 Research with 136 retained records and null local caps**. These cache-only verification reads made zero provider requests; the live candle receipt and original research stayed preserved. Local runtime stability remains an operational follow-up.

Commands (repository root): `pnpm --dir discovery types`; `pnpm --dir discovery test src/research-limits.test.ts src/source-collection.test.ts src/score-research.test.ts src/score-model-research.test.ts src/gmgn.test.ts src/gmgn-candles.test.ts --testTimeout=30000 --maxWorkers=1`; `pnpm --dir discovery typecheck`; `pnpm --dir app test src/discovery`; `pnpm --dir app test src/discovery/ScoreResearch.test.tsx`; `pnpm --dir app build`; `node --test scripts/discovery-migration-state.test.mjs scripts/discovery-lifecycle.test.mjs`; `pnpm exec tsx scripts/generate-discovery-openapi.ts`; `node scripts/discovery-gmgn.mjs status`; `node scripts/discovery-gmgn.mjs review ZyGXWijSJEgcCDb8CeSJ4Vj33iceATGoeKGidnfpump candles`; `pnpm exec tsx scripts/check-score-research.ts`. Private ignored helpers performed cached-receipt summarization, immutable-row comparison and secret/link checks. No deploy.

Next: investigate complete candle coverage using supported bounded Free queries; corroborate units and canonical scope; retain matched prospective observations before a scoring change. Restore bounded mode before any production release.
