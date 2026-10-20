# Replayable local discovery elections

20 October 2026, Australia/Sydney. PRD M1 election dry-run and audit milestone; local Worker/D1 and existing preview tunnel only. No deployment, new paid service, remote resource, signature, transfer or production voting policy.

## What is implemented

- `/elections` shows the latest ten local discovery rehearsals. `/elections/:id` exposes the frozen policy, all retained candidate decisions, observed time, counts, hashes and verified replay. Older records remain accessible by ID.
- Each run freezes the complete bounded local live-candidate inventory before applying the eligibility gates at its actual observation time. Fixture-mode rows cannot enter. Creation age, fresh market/risk/holder/wallet evidence and unknown market cap remain gates. Evidence fetched/observed after the snapshot is rejected.
- Eligible candidates are ordered by liquidity descending, creation time ascending and case-sensitive ASCII address ascending. Only at most 100 receive ranks. This is a **discovery rehearsal**, not community backing or a launch election. No live voting parameters or financial settings were selected.
- Empty or entirely provisional/excluded inventories produce `no_eligible_winner`. A simulated discovery winner cannot enable a launch. The local $10X, AMM, custody and approval decisions remain open.
- The first local maintenance tick each **UTC day** records one daily rehearsal at its actual observation time. Sleeping days are not reconstructed. This schedule is a local readiness check, not an approved voting cutoff. It continues using cached data while source ingestion is paused or quotas/providers are unavailable; stale evidence cannot be made fresh by running a rehearsal.
- Daily failures are recorded in status and shown on the rehearsal page, retried at the next maintenance tick, and do not suppress the heartbeat/research loop. Previous snapshots remain available.
- Manual runs accept an optional UUID `request_id`. Reusing it returns the original saved result even after candidate prices/data change. The admin button retains its ID after a failed request. CLI retries can supply the same ID explicitly.

## Persistence and replay

Migration `0009_elections.sql` adds `tenx_election_runs`, an index, update/delete rejection triggers, and a local control error field. Prior `tenx_dry_runs` records are preserved; they are not relabeled as v1 replay-certified records. New snapshot and audit writes use one D1 batch, a stable primary key and one audit ID. Concurrent duplicate requests cannot create another snapshot/audit. A failed audit rolls back the snapshot.

`election-input-v1` freezes the policy and normalized candidate states, including their retained proof/evidence references; it does not duplicate every referenced raw RPC body. `election-result-v1` freezes all decisions and reasons. SHA-256 hashes bind inputs and results, and a record hash binds their hashes to the run ID/kind/day/time. Public detail reads recompute selection from frozen inputs, compare the result and verify all hashes. They make **zero provider requests**. Replay establishes retained-data/rule consistency, not an externally anchored commitment, completeness of chain history, cryptographic validation of every RPC response, or token safety.

`discovery-election-v1` uses the current versioned eligibility model. Preserve this behavior and the sealed fixture when changing rules or schemas; introduce a new engine version rather than rewriting historical results. `fixtures/election-v1.json` is explicitly **synthetic offline test data**, including a test policy with holder/wallet gates disabled to exercise a simulated winner. It is never seeded into the live inventory and is not an approved production policy.

Resource bounds: at most **500 retained live candidates**, 1,600,000 input bytes and 200,000 summary/result bytes per run. A single inventory SELECT computes size/count before returning payloads. Larger inventories fail visibly rather than dropping candidates or certifying a truncated winner. This is a current limit: an archive/windowed inventory or segmented snapshot design is needed before longer-running collection exceeds it. No automatic deletion of candidates or election history was introduced. The ten-item history view limits public read size; old snapshots remain stored.

The existing free RPC/market budgets are unchanged. No new env variable or credential is needed. `TENX_LOCAL_ONLY=true` and the existing local maintenance timer remain required. Turning off market/wallet collection does not make missing or stale evidence eligible. Local replay does not establish that a future hosted Worker will fit free-tier CPU/storage limits.

## Observed local evidence and checks

The existing automatic timer created `daily-2026-10-20` at **2026-10-20T03:33:09 UTC**: 341 stored candidates, 0 eligible, 47 provisional, 294 excluded, no winner. Independent replay verified input hash `26703f82476f449531c70da0b66b07a2bb508e974663328c00e0eff4126133a2`. These counts describe the full rehearsal inventory; the public contender list remains capped at 100.

Two concurrent local POSTs using `e1ec7100-2026-4020-8000-000000000001` returned the same record hash. Local SQL confirmed exactly **one snapshot and one audit**. That later inventory had 342 observed candidates, still no eligible winner. An independent checker replayed this run, another cached operator run and the daily run with zero provider requests.

Commands run:

```powershell
pnpm --dir discovery typecheck
pnpm --dir discovery test
pnpm --dir app test
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm --dir discovery exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
node scripts/discovery-operator.mjs maintenance
pnpm exec tsx scripts/check-discovery-elections.ts
pnpm exec tsx scripts/check-discovery-local.ts
git diff --check
```

Result: **122 discovery tests / 11 files**, **773 app tests / 128 files**, typechecking, app build and performance budget passed. Tests cover the sealed v1 replay, deterministic ties/caps, unknown FDV-only cap, stale age/data, future evidence, fixtures/duplicates, retries after source deletion, audit rollback, immutability/tampering, missed days, authentication, no-provider operation, paused/exhausted sources and visible size/count failures. Cached smoke checks replayed three holder and three wallet snapshots; financial capabilities remain disabled. The history and detail view were inspected in the existing local browser.

Repeat an operator run without changing the request identity:

```powershell
node scripts/discovery-operator.mjs dry-run 00000000-0000-4000-8000-000000000004
node scripts/discovery-operator.mjs dry-run 00000000-0000-4000-8000-000000000004
pnpm exec tsx scripts/check-discovery-elections.ts manual-00000000-0000-4000-8000-000000000004
```

Files: new election model/engine/tests, sealed fixture, migration and independent replay checker; updated Worker routes/maintenance/status, store wrapper, operator CLI, generated OpenAPI, app client/views/routes/shared-model watcher and navigation layout; review/index/runbook notes. No new dependency or signing capability. Feature-branch commit/push does not trigger the main/dev/tag deployment workflows.

Next PRD step: signed-wallet identity and read-only eligible-purchase reconciliation, with domain-separated single-use challenges and deterministic trade deduplication. Community scoring/cutoff/caps remain proposed until reviewed. Before prolonged collection, remove the monolithic snapshot limit through explicit archival or segmentation; never silently omit potentially eligible candidates.

Primary references checked: [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/). No production readiness or deployment is claimed.
