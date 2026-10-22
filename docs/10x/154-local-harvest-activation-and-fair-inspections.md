# 154 — Local harvest activation and fair first inspections

22 October 2026. Continues [153's discovery-quality correction](153-discovery-quality-and-intake-review.md). The founder explicitly authorized applying migration 0047 locally. Production exposure and deployment remain closed.

## Local activation

Applied only `0047_migration_harvest_continuation.sql` through Wrangler 4.126.0, with explicit `--local`, the existing `wrangler.local.jsonc` binding and the preview's existing `.wrangler/local` persistence root. The prior ledger had 46 migrations and only 0047 pending. All 47 are now applied. This supersedes the staged-only activation status recorded in 153; its original measurements remain historical evidence.

A consistent SQLite backup was completed before application and passed integrity checking. Afterward, database integrity and foreign-key checks passed, the six intended control columns exist, other table schemas are unchanged, the original completed boundary was preserved and all 23 pre-existing usage rows remain without reset. No evidence, inbox, lead or quota history was deleted. The running preview's cache-only yield route recognizes an idle, ready checkpoint rather than `migration_required`.

Private backup: `.tmp/local-migration-0047-20261022-154-001/before.sqlite`, SHA-256 `ad1299eaa45c9fca4455a9a09d672b556b7643a1040b79a294af03e31069f7c3`. Migration source SHA-256: `ddd1be385e17b6b9b245fb997809aa59782deb607e25ac7dea12f83ed53b8f0a`. Activation receipt: `.tmp/local-migration-0047-20261022-154-001/after.json`, SHA-256 `07345bfbbc069a9290a59365dffe0985ffd189ec647ab03e8205a1b75963c37b`. First running-preview observation: `.tmp/discovery-154-observed-001.json`, SHA-256 `bd61f7f31f3b1abba14aace2a93625c0d24bb9441d0ee24a14ce4eda3813607b`, at 10:56:06 UTC. This first observation has revision zero: readiness alone is not proof that an authority page has already been collected. The existing paced background collector continues independently; no forced refresh, cursor repair or historical backfill was requested.

For reproduction, inspect the pending ledger and use the preview's exact persistence directory, rather than creating another local database. The [current D1 migration command reference](https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply) documents `--local` and `--persist-to`.

```powershell
pnpm --dir discovery exec wrangler d1 migrations list TENX_DB --local --config wrangler.local.jsonc --persist-to C:/Users/cjacob/Documents/GitHub/WarpletsAPI/discovery/.wrangler/local
```

0047 prevents future completed-cursor skips after activation; it does not reconstruct signatures skipped by the former reader. One page of 30 per ordinarily admitted harvest, authority/lease/revision/commit fences and all original source checks remain.

**Ordinary runtime confirmation:** the paced refresh started at 11:06:40.398 UTC and succeeded at 11:07:04.405, using 21 RPC calls and completing two inspections. Its harvest advanced to revision one with a saved head/continuation and bound authority, while retaining the original completed cursor. The interval remains continuing, not complete or exhaustive. Read-only boundary confirmation `.tmp/discovery-154-live-checkpoint.json`, SHA-256 `e7c176f54ad939197bc9c6d980ef1dfd8d192a43654bbd143bb0e5370b3b85bf`. The inbox increased from 4,934 to 4,952 retained signatures; those 18 added rows are not 30 new migrations or recovered old-gap history. No forced refresh or restart was used. Private cached observation `.tmp/discovery-154-observed-004.json`, SHA-256 `5bfb54b54f4e55b09e83d819bf09ce392af2de5a5f195deed79977cc8d417bfa`.

A frozen pre/post lead-metadata comparison confirms **one previously unchecked lead completed its first inspection**, while the selected retry moved from seven to eight attempts. Both retain the ordinary cycle timestamp. This proves those two completions, not token quality or sustainable service capacity. Private baseline `.tmp/queue-execution-20261022-154-before.json`, SHA-256 `4b6216e99c0f7dbb050c08244cc61ec7693fa20a0f08851f9bf99c0fe8b127b4`; result `.tmp/queue-execution-20261022-154-after.json`, SHA-256 `8a2459333ee757bed5e9220a0a829b53ae1f39f22cb9a28a64dbde1953b5b180`. These read-only measurements caused zero provider calls or writes; the observed ordinary collector made the recorded 21 calls and retained its normal writes.

## Fair inspection allocation

The first selected position now belongs to the oldest due, previously unchecked lead, with address as a stable tie-breaker. The second belongs to a due retry using the existing reported market-floor, missing-creation and liquidity priorities. If either lane is empty, the other can use both positions. No duplicate lead is selected. First inspection comes first because the sequential collector can exhaust its safe call allowance before reaching the second position.

This is an allocation change inside the existing maximum of two selected leads, six intake bodies and 24 RPC calls per cycle. It retains daily/shared/subset reservations, pacing, provider backoff, current ownership, transaction/state/proof/receipt validation and the original creation-dependent retry delay. A selection is only an opportunity: budget or source failure can leave it uncompleted. A saved provisional candidate is not recovered creation, organic attention, a good token or action eligibility.

Additive cycle diagnostics distinguish selected first/retry work, completed first/retry work and work deferred by the safe cycle call bound. Completion follows the original candidate save and lead update, never selection or a failed provider request. These counters describe the ordinary result; they do not grant another source request or replace retained jobs and lead history.

Malformed, noninteger and future migration headers remain retained but unselected. Invalid priority-cache JSON becomes missing queue fields, without evidence credit. Full transaction/state parsing remains mandatory; valid JSON containing a schema-invalid transaction can still hold ingestion without being marked checked or completed. A durable failure/quarantine workflow remains separate work, rather than silently discarding or admitting that row.

## What the queue measurement establishes

A read-only snapshot at 10:56:25.883 UTC retained 1,230 leads, including 381 past-day graduations. Of 379 due, nonexpired leads, 273 were unchecked and 106 were retries. Unchecked leads had waited a median **13.30 hours**, with a maximum **23.84 hours**, since retained first observation. These are pipeline waiting times, not chain-to-ingestion latency.

At that same cutoff both selectors chose one first inspection and one retry. The former selector put a seven-attempt creation-unknown retry first and a 29.3-minute-old unfamiliar lead second. The new selector put the oldest, 23.84-hour-old unfamiliar lead first and retained that retry second. This demonstrates better opportunity allocation, not more total inspection capacity or completed verification. The initial private census is `.tmp/lead-queue-census-20261022-154-001/report.json`, SHA-256 `f17731c0258cc94df649895e911e0182ce015b6be5f015b4cccefb6a403d444f`; its code pin identifies that measured query revision.

Only four of the 106 due retries lacked creation evidence at this cutoff. Retained source codes included four scan-limit and four unverified-holder observations, plus one RPC HTTP error. Codes overlap and may be stale. Repeated origin work is therefore one contributor, not an adequate explanation of the entire unchecked backlog. Native selector wall time of 104.4 ms does not certify Worker CPU, billing or production latency.

The final JSON-guarded query was measured separately at 11:02:16.853 UTC: 381 due leads, 273 unchecked and 108 retries, with unchecked median/max waiting of 13.393/23.940 hours. The same first-versus-retry ordering improvement remains. Native selector wall time was 145.14 ms. Private report `.tmp/lead-queue-census-20261022-154-002/report.json`, SHA-256 `e710c7000d037bf95dfadf0fb348deb3762f6ed1d6c12f1bf1fcf22d8ead55fe`, binds final queue source SHA-256 `f19a4bc59671408fc64e4fe06b2b5c19e674fd98bec6bb6a4e97491a24dfb41a`. Both censuses use a single native read-only/query-only transaction with zero writes, provider requests or collection triggers; different cutoffs are not an outcome experiment.

Two cache-only observations at 11:03:32 and 11:06:02 UTC retained the same 1,230 leads and 652 unchecked rows, but daily graduation leads fell from 381 to 378 and their unchecked subset from 273 to 270. Three uninspected leads had left the inspection window. This is an observed window-loss example, not evidence that fair selection recovered them or that source limits should be relaxed. Private observations `.tmp/discovery-154-observed-002.json` / `003.json`, SHA-256 `b1335af663a5ac702c24887956748714d1a291a7ba0ab47944e5b35aa7a69be9` / `c8aeca4b94bf1a3ccb4d7185ab22e44d891d5df5e3ac76675c40f6d02f738712`.

## Validation

- **120 tests across six affected backend suites pass**, including ten queue cases, 27 harvest-continuation cases and two new end-to-end collector cases. Forty synthetic allocation cycles prove that newer arrivals cannot overtake the original waiting cohort; this is not a sustained live-throughput claim.
- The constrained execution case uses exactly 16 admitted RPC calls: seven preliminary calls plus a nine-call first inspection. The retry remains unattempted, the unfamiliar lead has one completed inspection, missing creation remains provisional and eligibility stays held. A separate provider-abort case records no completed inspection.
- Discovery typecheck, scoped whitespace checks, security preflight/blocklist and the existing thesis-only artifact check pass. No interface source changed; this does not claim new enabled-route performance or independent UX acceptance.
- Original research row digests/foreign keys, 59 frozen private proof/journal artifacts, actual credential exclusion and unchanged v4/config/limits/dependencies pass preservation checks. The authorized live local schema addition is separate from those preserved historical targets.

```powershell
pnpm --dir discovery test -- src/lead-queue.test.ts src/migration-harvest.test.ts src/service.test.ts src/inbox-recovery.test.ts src/mint-review.test.ts src/discovery-yield.test.ts
pnpm --dir discovery typecheck
pnpm security:preflight
pnpm security:test
pnpm --dir app release:check
```

## Next outcome-led work

1. Measure ordinary first-inspection completion, call cost, waiting age and leads leaving the 24-hour inspection window unchecked. Fair allocation alone cannot establish that admitted throughput matches arrivals. Do not extend evidence freshness or inflate limits to conceal this mismatch.
2. Separate graduation-day investigation from creation-day action scope. Unknown creation remains an explicit evidence hold while recent graduates can be investigated. Preserve the original first-day action policy.
3. Freeze an independently seeded cohort through already admitted free feeds, with source-union-relative recall, miss reasons, useful unfamiliar graduates/day and fresh top-20 coverage. A provider's list or organic label remains a lead, never proof.
4. Build preregistered qualified participation and prospective attention comparisons against frozen v4. Raw reported volume and dust holder growth still earn no organic-demand credit. UI labels continue to say structural support.

The initial preview observation had 286 current candidates, including 182 creation-unknown; after the ordinary cycle it had 287 current candidates and the same 182 creation-unknown. More first inspections can create more provisional rows; the existing 500-candidate ranking guard remains binding. Track saturation and source-bound preparation cost before any runtime or capacity adoption. Independent usability/accessibility/mobile/actual text zoom, enabled-route security/performance, 149's held Free-serving decision and required recovery acceptance remain open.

Keep all services free, frozen v4 and every source/evidence/time/action/election/financial/release gate unchanged. No paid source, provider expansion, allowance reset, evidence deletion, historical-owner resumption or deployment is authorized by this delivery. Thesis-only production exposure remains.
