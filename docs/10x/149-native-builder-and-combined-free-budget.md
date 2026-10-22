# Native builder costs and combined Free budget

22 October 2026. Continues [148's serving assessment and approved build order](148-free-serving-assessment-and-build-order.md). This delivers native builder measurements and a combined workload worksheet. It does not adopt compact serving, start a schedule, change a model or evidence gate, or authorize a release.

## Decision

**Do not adopt continuous whole-inventory minute rebuilding on the current Free design.** Compact reads help, but the unchanged builder's repeated history scans exceed the shared Free read budget in the measured archive scenario before any visitor traffic. Free serving acceptance remains held. This is a concrete cost blocker, not simply a lack of latency measurements.

The Free serving assessment now has an explicit decision and named outstanding acceptance work. **Next product slice: daily-decision UX and rendered artwork acceptance**, using saved observations and the existing local preview. Follow with unfamiliar-token yield, qualified participation and read-only release/security acceptance as approved in 148. Capacity engineering remains a named release blocker alongside these product outcomes; do not default back to generic recovery work or another single-token investigation.

The specific serving follow-up is to prototype bounded, source-revision/hash-bound reuse of expensive v4 input preparation, starting with the history scans identified below. Require exact full-evaluator card/rank/filter/cursor parity, original source/time/policy/generation checks, race/rollback tests and complete native costs before considering adoption. Reusing prepared inputs must not reuse stale scores or turn unknown provenance into passing evidence. This is a proposed experiment, not an approved cache format or runtime change. CPU, memory, shared account/storage/growth and actual serving arrangement still need their own acceptance evidence.

## Native method and isolation

`scripts/discovery-builder-serving-study.ts` invokes the existing authenticated `POST /api/10x/admin/score-read-pages` through the unchanged Discovery Worker router inside local workerd/D1. The test-only wrapper allows just this route, requires an independent random study token, retains real admin Bearer/origin/local-runtime guards, blocks outbound traffic and permits instrumented writes only to the three disposable projection tables. No production configuration imports it; no original or live database is writable.

The study recreates **all 85 current migration tables and every original index/view/trigger**. Selected candidate/history/control records and migration defaults are copied into disposable fixtures; other retained domains are not reconstructed. Full schema matters: candidate-update guards reference backing tables even when those domains are empty. The reduced read-only closure from 148 cannot be used to test source edits by omitting those guards. No guard is removed. Candidate edits here change one copied symbol only; their cost includes original index/revision triggers but is not the cost of a real collector or complete candidate-save workflow.

Fixtures match 148: 244 selected archived candidates with 6,321 history rows through the frozen cutoff, and 500 distinct wide synthetic candidates without history. Each starts with no projection. First build, identical replay, one-body edit at the same cutoff, paused hold, next-cutoff refresh and older-builder rejection use original code. A new isolate supplies each immutable historical clock; no mutable request clock or production clock is changed. After each successful build, every card across all inventory pages matches an independently run original Node evaluator; reads must not mutate any fixture table. Each build must leave **every non-projection table** unchanged. Empty other domains and omitted expired candidates mean these are selected-fixture costs, not full original-store or production acceptance.

Five native auth/origin/local-runtime/host/schema probes per fixture reject before database access. A second copied-symbol stimulus makes an earlier body write necessary; the injected final-manifest failure fires only if that changed body is already present inside the transaction. All 85 tables must then match their pre-call state, proving rollback of an actual earlier write. The expected 503 is a controlled test failure. Only that disposable symbol stimulus is restored afterward through the original triggers; source revision advances again and is never reset. Paused/older builders must hold without projection changes or row writes. A failed batch does not return complete statement metadata, so its billable cost remains unknown rather than being recorded as zero. Source revision must advance exactly once for the separately measured controlled source edit.

The instrumentation records native `rows_read` and `rows_written` separately from `changes`, including indexes/triggers reflected by those counters. It rejects foreign statements, direct source writes, raw/exec/session escapes and invalid counter values. Original batch execution is retained; tracing does not replace transactional guards. These are **local native D1 counters**, not remote billing evidence or Workers CPU. Single-run host wall times are diagnostics only, not a latency benchmark or CPU acceptance.

## Results

Private final report: `.tmp/builder-serving-20261022-149-004/report.json`, SHA-256 **`e8e42f3dd14663823c9c2dc9058a650a2db0d6cd02ad11f8b53a57186e428801`**. Both fixtures complete seven cost observations and six boundary/rollback probes, including the conditional failure after a real body write. Original source and reader-report bytes remain identical; outbound attempts/provider calls are zero. All built generations pass complete card parity; all held/rejected cases preserve their required table state.

| Operation | Archive reads / native writes | Synthetic 500 reads / native writes |
|---|---:|---:|
| First build | 53,164 / 499 | 5,569 / 1,021 |
| Identical replay | 54,168 / 0 | 7,627 / 0 |
| Controlled source edit, including revision trigger | 249 / 3 | 505 / 3 |
| One-body edit rebuild, same cutoff | 54,168 / 3 | 7,627 / 3 |
| Paused builder hold | 1 / 0 | 1 / 0 |
| Sixty-second cutoff refresh | 54,168 / 11 | 7,627 / 21 |
| Older-cutoff builder hold | 53,653 / 0 | 6,580 / 0 |

Builders use 14 statements; an early paused hold uses one. The first archive build makes 255 logical changes but reports 499 native row writes; the synthetic first build makes 521 logical changes but reports 1,021 writes. Logical changes therefore cannot stand in for write budget. Identical replay avoids writes but still performs the expensive evaluation/read work.

On archive refresh, the two history queries account for **31,718 + 20,183 = 51,901 of 54,168 reads (95.8%)**. Current candidate selection accounts for another 977. This identifies input preparation as the first optimization target while retaining earliest-quote and bounded-window semantics. The synthetic no-history case still reads 7,627 rows per refresh: fixing only history is not sufficient proof of Free fit.

## Combined workload worksheet

`scripts/lib/discovery-serving-workload.ts` models named components: readers, first build, scheduled refresh, source edits and event-driven rebuilds, plus other shared requests/reads/writes. Unknown frequency/counters/background/CPU/storage remain unknown. Safe-integer validation prevents rounded overflow from becoming a pass; duplicate names are rejected. Native writes and logical changes remain separate. Even an entirely known under-budget scenario always returns `decision=held`, `free_acceptance=false`, `action_authority=false`.

The scenario assumes a full visible day of one-minute page-one reader polling, **one first build plus 1,439 refreshes**, and extrapolates the observed single refresh at each later cutoff. It is not a measured day, forecast of growth or schedule recommendation. Source updates, event-driven rebuilds, failed attempts, other endpoints/collectors/projects and full storage are unknown, not free capacity. A 60-second validity window is unchanged; exact-minute scheduling assumes instant successful publication and does not prove gap-free availability. Any slower modeled refresh explicitly reports a gap.

| Selected fixture | Continuous viewers | Known minimum reads/day | Known minimum writes/day | Decision |
|---|---:|---:|---:|---|
| Archive | 1 | 78,214,036 | 16,328 | Read ceiling exceeded; total usage unknown |
| Archive | 10 | 80,132,116 | 16,328 | Read ceiling exceeded; total usage unknown |
| Archive | 30 | 84,394,516 | 16,328 | Read ceiling exceeded; total usage unknown |
| Synthetic 500 | 1 | 11,287,542 | 31,240 | Read ceiling exceeded; total usage unknown |
| Synthetic 500 | 10 | 14,048,022 | 31,240 | Read ceiling exceeded; total usage unknown |
| Synthetic 500 | 30 | 20,182,422 | 31,240 | Read ceiling exceeded; total usage unknown |

The archive builder subtotal alone is **78,000,916 reads/day** in that scenario. Write subtotals being below a daily ceiling do not imply shared write acceptance. Per-invocation query counts being below 50 do not imply daily-read or 10 ms CPU fit. Current documented D1 Free allowances remain **5 million reads/day and 100,000 writes/day**, with index work included in the cost basis. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/). No paid fallback, limit increase, longer freshness window, evidence deletion or automatic runtime switch is introduced.

## Reproduction and validation

From the repository root with locked dependencies:

```powershell
pnpm test:discovery-serving-capacity
pnpm exec tsc --noEmit -p tsconfig.serving-study.json
pnpm exec tsx scripts/discovery-builder-serving-study.ts SOURCE_SQLITE SOURCE_SHA256 CUTOFF READER_REPORT READER_SHA256 NEW_PRIVATE_OUTPUT
```

The retained source is `.tmp/discovery-metadata-unsealed-20261022-001/capacity/capacity.sqlite`, SHA-256 `c5bd52a6eeb0aa6b726cd05754779bd2a7e059171c226e964f3f0ac66b03d801`, cutoff `2026-10-21T14:24:50.571Z`. Reader input is `.tmp/free-serving-20261022-148-003/report.json`, SHA-256 `423ff7f03e6317f5a7587a033dc1013baa425c3d181c31c2c1ce6dfe87c985e8`. Both pins are required and checked before/after. Use independently retained pins, exclusive private output, no credentials/live bindings and no overwriting prior proofs. Scratch migration/schema writes are disposable only.

All **28 capacity/instrumentation tests and 28 existing reader/request-security/browse tests pass**, along with scoped types. The combined capacity tests run through the existing security CI command; scoped types include the native study. Current Cloudflare docs and separately retrieved Workers types `5.20261022.1` were reviewed; the repository's compatibility date and dependencies remain pinned. Security preflight/blocklist, original row/foreign-key preservation and thesis-only artifact checks pass. Frozen preservation and actual-key exclusion cover the existing 59 private proof/target/journal artifacts and 66 built assets; the old 437-case evidence matrix is preserved, not rerun or counted as new coverage. Existing archives, raw evidence, private keys, frozen journals/proofs, cohorts, elections, spent allowances, v4 and all source/evidence/time/action/election/financial/release gates remain unchanged. No provider call, spending, collection, quota reset, evidence deletion, runtime adoption, restart, live migration or deploy.
