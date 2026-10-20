# Funding completion and collection yield

20 October 2026, Australia/Sydney. This advances P3 in the [PRD task map](19-prd-task-map.md). Free services, local database and preview only; feature-branch commit/push, no deployment. **Ten eligible recent tokens remain an open target.** No evidence gate, threshold, freshness interval or sampling bound changed.

## Diagnosis

At approximately 20:48 Sydney time, the local cache held 381 tokens, 209 with verified creation within 24 hours, ten passing fresh market floors and nine passing all non-wallet gates. Zero passed every gate. Wallet use was 534/800 requests inside 1,767/5,000 global RPC reservations; the existing 180-call catch-up reserve was already exhausted.

Several buyer windows contained 50 successful references but could accept only twelve decoded bodies. Repeatedly fetching those bodies could not complete a window under the existing bound. An empty archival response also remained a blocking missing boundary. Meanwhile AODF `MFgq2fX…` had four queued bodies across three nearly finished windows. Scheduling relied partly on older wallet snapshots and the cost of a previous turn rather than verified current checkpoints.

## Implementation

The collector now separates **work feasibility** from the historical evidence decoder. `fundingTask` detects a window with more than twelve required bodies immediately and avoids further body requests for it. Missing dates, missing/unsupported transactions, ended history and page caps remain explicit blockers. The original `fundingCoverage` calculation, historical input versions, outputs and hashes stay unchanged. Within a token, finishable windows with an observed dated boundary and fewer remaining bodies take priority, retaining the three-window/three-new-body-per-window bounds and overall 18-call ceiling.

`walletPlan` replays the current retained wallet input, validates exact checkpoint anchors/hashes and rejects future checkpoints. For actionable work it also retrieves and replays every previously examined body; an availability marker is insufficient. Missing/corrupt bodies fail closed before new provider work. Pending cached bodies are hash/identity checked for the request estimate. Transaction-count and serialized-body bounds remain intact. Planning is read-only and cannot update candidate freshness, profiles, cohorts or eligibility.

Automatic wallet scheduling considers up to twenty due current contenders, skips known source/sample limits and invalid caches, prioritizes fresh non-wallet passes, then a required fresh snapshot, resumable work by cost, and initial samples. Ties retain oldest-attempt fairness. A request estimate includes cluster verification, known uncached bodies and at least one request for each unfinished page chain. It is a lower bound, not a completion quote: new pages can reveal additional bodies or a blocking limit. Unknown initial/full-snapshot cost remains unknown. Planner observations are rechecked each tick; fixing a source or decoder requires verified evidence, not clearing a gap flag.

Normal pacing uses the known-work estimate initially and the actual successful-turn cost afterward. The existing catch-up reserve, atomic wallet/global limits, per-address retries, pause, leases and provider backoff remain in force. Explicit operator requests also return known blockers with zero provider calls instead of repeating an unfinishable refresh.

Additive local migration `0016_wallet_yield.sql` records turn kind, actual RPC calls, outcome and net additional completed windows confirmed by successful replay. Failed turns count their requests and failure, with zero claimed completions. Partial progress left before a failed replay is not credited; these are conservative operational measurements. Fresh snapshots and increases in buyer observations are separate counters, not recommendations or unique people. Earlier turns are not backfilled. The rolling 24-hour request-per-completed-window ratio includes successful and failed calls since measurement began; no completions gives an unknown ratio.

`GET /api/10x/discovery/wallet-plan` exposes bounded plans and yield from saved local data, with zero provider calls and no public write route. Discover displays actionable work, gaps, request lower bounds and actual measured yield. Existing continuation progress and original wallet timestamps remain separately visible. The summary is at most twenty current potential contenders and discloses capping. Provider allowances and polling cadence were not increased; no dependency, credential, remote resource or financial capability was added. Local query/CPU/storage costs still need profiling before any remote release.

## Local result

At 21:01 Sydney time, a bounded AODF continuation used **five actual RPC calls**, decoded four more bodies and increased examined direct-funding windows **from 2/6 to 5/6**. The retained wallet snapshot stayed at `2026-10-20T04:29:55.351Z` (15:29:55 Sydney); it did not become fresh eligibility evidence. The remaining creation-wallet window still needed a dated boundary. The first telemetry result was three newly completed windows, 5/3 = 1.7 requests per completed window, zero fresh snapshots and zero failed turns.

The cached planner then showed five resumable contenders, three needing an initial snapshot and six blocked by current source/sample limits. These are investigation states, not eligibility counts. Freshness and market/holder results continue to fluctuate while the timer runs. The target remains zero of ten until every current gate actually passes; progress counters do not fill shortlist places.

## Validation and next work

The full discovery suite passed 218 tests across 24 files. Coverage includes early detection of oversized windows without body spending, bounded finishable draining, original recorded funding replay, exact-anchor integrity, missing/poisoned pending and examined bodies, future checkpoints, automatic/manual skip, actual quota accounting, pacing, pause/backoff and read-only public APIs. Discovery typecheck, app build/performance budget and local browser verification passed. The cache-only smoke checker replays retained wallet inputs and checks the active policy and usage ceilings.

```powershell
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-discovery-wallet-plan.ts
# From discovery/, local only:
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
# Existing quota-respecting operator:
node scripts/discovery-operator.mjs wallet-refresh MFgq2fX5egVFd5xKsQkjr7PNfF3PcaLWnnv7Nvmpump
git diff --check
```

Next coverage work must certify recoverable transaction paths and source boundaries, retain exact initial samples through failed acquisition, and compare sustained fresh-snapshot cost against the free allowance. Empty history is still not evidence of no earlier activity. No additional archival source, higher transaction cap, relaxed freshness, paid API or favourable ranking for paid/promoted tokens is approved by this iteration. The [local reliability exercise](19-prd-task-map.md) remains a separate next work package.

Primary references: [Solana address history ordering and cursor parameters](https://solana.com/docs/rpc/http/getsignaturesforaddress), [Workers practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/). Research hypotheses, trading risk and source coverage remain distinct from an eligible recommendation.
