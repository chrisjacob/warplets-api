# GMGN candle contract correction and descriptive trading review

21 October 2026 (Australia/Sydney). Continuation of the [first live GMGN checks](72-gmgn-live-test-capacity.md), requested by the founder. Local changes only; no deployment.

## Evidence and diagnosis

Our original candle contract required second timestamps and both `volume` and `amount`. GMGN's official [contract due-diligence skill](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-contract-dd/SKILL.md) includes a measured candle with a **millisecond** timestamp and no `amount`. This public example reproduces a rejection by our original parser. The [market skill](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-market/SKILL.md) instead describes seconds. Its introductory guidance and response-field table also disagree about USD versus token volume units. Its [CLI](https://github.com/GMGNAI/gmgn-skills/blob/main/src/commands/market.ts) converts input seconds to HTTP milliseconds; our existing request conversion was already correct.

The original failed HTTP-200 receipt `a028ad47-d3d6-40aa-b641-5de33c85e1e6` discarded its body as required. It cannot retrospectively establish which particular field failed. The correction addresses documented reproducible contract incompatibilities; it is **not** a claim that this discarded body has been recovered or that a new live candle response passed.

## Corrected contract

The [v2 candle normalizer](../../discovery/src/gmgn-candles.ts) accepts an array or an object containing `list`, with at most 360 candles. It matches either seconds or milliseconds against the explicit requested window and requires one consistent unit across the entire response. It accepts strictly ascending or descending rows, reversing only the latter. Duplicate or non-monotonic rows, mixed units, fractional/non-minute times, open/future/out-of-window bars, non-finite values, invalid OHLC, negative flow and overflowing aggregates remain rejected. It never rounds timestamps, silently drops malformed rows or fills missing minutes.

`amount` may be absent or null; neither means zero. Field-labelled raw sums remain available privately, with missing sums unknown. New observations expose **neither a USD sum nor a token-unit sum** until units are corroborated. The separate token-info 24h/1h USD reports retain their existing attribution and are not replaced by a six-hour candle total. Canonical pool/mint binding remains request-context-only for candles; no chain proof is invented.

New successful receipts identify selected-field contract v2. Old v1 receipts replay with the original v1 normalizer; their bytes/hashes and historical interpretations are preserved. The current public projection withholds ambiguous candle USD totals even for v1. Invalid bodies remain discarded, with only a fixed, sanitized validation reason saved for subsequent diagnosis. No upstream text, credential, arbitrary schema error or new raw-data route is exposed.

## Earlier trading-pattern review

The cache-only [GMGN evidence panel](../../app/src/discovery/GmgnEvidence.tsx) now shows candle coverage and descriptive measurements for adjacent closes, longest uninterrupted rising run, alternating up/down candle bodies, doublings/halvings and moving candles with both flow fields explicitly zero. Missing minutes break runs and cannot become one-minute jumps. Missing flow never becomes zero.

Review reasons are explicit and provisional: an adjacent close doubles/halves; a candle moves with both reported flow fields explicitly zero; or at least twelve consecutive adjacent closes rise. These are **uncalibrated investigation prompts**, not a fraud classification. An organic uptrend can trigger review; absent triggers do not certify clean trading. Candles cannot identify wash counterparties, common wallet control, dust-resistant holder growth or the launch valuation. No derived finding changes score-v4, eligibility, election results or action gates. Prospective independent validation remains required before scoring adoption.

The summary retains the candle window and its own receipt time. Partial coverage and stale receipts stay visible. Browsing a token only reads saved evidence; it does not trigger provider IO.

## Free operation and live-check boundary

All existing limits remain: **120 shared records per UTC day**, **10 MB**, **20 source HTTP attempts inside the configured market allowance of at most 600/day**, standard one-minute GMGN reads of weight two, ten-second spacing, one in-flight request, owned leases, timeout/backoff and the existing single allocated maintenance slot. No Pro route, paid fallback, new timer, forced refresh, refund, counter/day reset, historical replacement or capacity increase.

The current-day aggregate reached **120/120** before this fix. A new live retry must remain held by ordinary admission until capacity becomes available on the next UTC day. The normal pilot can then try its previously declared targets; failed attempts still count and cannot loop within a day. No direct request bypasses the shared guard to obtain a convenient fixture.

## Verification and next work

- Offline regression includes the exact public vendor example, valid 360-minute windows, second/millisecond and reverse-order cases, missing turnover, duplicates/mixed units/order/OHLC/window/overflow rejection, gaps, explicit zero versus missing flow and untrusted metadata stripping.
- Integration tests cover one admitted HTTP call, counted failures with sanitized reasons, hash-verified replay, archived v1 compatibility, cache-only public projection and unchanged quota/pause/backoff/action boundaries.
- UI tests cover partial coverage, unknown units, descriptive review explanations and rolling compatibility with summaries lacking the new optional review field.
- Full Discovery run: **1,132 of 1,135 passed initially**. Two pre-existing backing/election tests hit the runner's five-second timeout under concurrent local load. A third test still seeded the superseded 100-record limit; its fixture now uses the central 120-record boundary. All **53 tests across those three files passed** on the isolated rerun with a thirty-second runner timeout. Runtime timeouts, evidence rules and production code for those gates were not changed.
- **86 UI tests across sixteen files passed**. Discovery typecheck and app typecheck/build passed. Home startup stayed **234.1 KiB gzip across eleven chunks**, passing its existing performance budget. OpenAPI was regenerated from runtime schemas.
- Browser QA rendered the real component with clearly labelled synthetic regression data and project styles, verifying partial coverage, unknown turnover, rising/alternating/zero-flow measurements and no candle-only wash verdict. No synthetic data was inserted into the local store or exposed as a provider receipt; the temporary QA server/tab were closed.
- An ordinary operator candle retry returned **held / zero provider requests**. Cached status remained **120 records / 2,061,917 bytes**, with six source reservations and unchanged backoff. The original hundred frozen cohorts and zero original outcomes remained byte-identical; foreign keys passed.
- The actual query key was absent from **twenty changed source/document files and seventy-two built assets**. Both secret files remain ignored and untracked. All **370 local Markdown targets across seventeen documents** resolved; whitespace checks passed.

Validation commands (repository root): `pnpm --dir discovery test`; `pnpm --dir discovery test src/backing.test.ts src/election-storage.test.ts src/score-model-research.test.ts --testTimeout=30000 --maxWorkers=1`; `pnpm --dir app test src/discovery`; `pnpm --dir discovery typecheck`; `pnpm --dir app build`; `pnpm exec tsx scripts/generate-discovery-openapi.ts`; `node scripts/discovery-gmgn.mjs status`; `node scripts/discovery-gmgn.mjs review ZyGXWijSJEgcCDb8CeSJ4Vj33iceATGoeKGidnfpump candles`; `git diff --check`. Private ignored helpers performed secret/link/frozen-row checks and synthetic browser rendering. The full suite's initial failures are retained here rather than reported as a clean single run.

Remaining: obtain a newly admitted real Free candle receipt after the UTC reset, inspect the retained v2 result and real coverage, corroborate volume units, verify canonical pool scope, collect matched wallet/trade evidence and compare prospective custom/vendor/hybrid observations before any new score policy. No deploy, signing, funding, trading or publication.
