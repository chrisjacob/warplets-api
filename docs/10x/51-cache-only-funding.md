# Cache-only funding continuation

21 October 2026, Australia/Sydney. Continues PRD §§4.4–4.5, 14.2, 17.1 and P3: improve inspectable funding coverage within existing free allowances. Local preview only; no deployment, paid service or financial capability.

## Finding

Planning already recognised cached transactions, but a normal continuation first spent an RPC call on cluster verification. A recovered marker could also make planning advertise a completed window before the changed checkpoint was persisted, or remain skipped because another wallet's window was source-limited. The next full snapshot then required source work even though the available checkpoint repair itself needed no new source observation.

The new `cached_funding` plan reports **zero RPC calls** and retains the counts of actually saved checkpoints. It is selected ahead of source work among current contenders. `funding-cache-work.ts` provides a read-only projection and an independently guarded adoption path with no RPC client or provider transport. It can consume supported saved bodies for pending references and adopt previously missing/unsupported markers repaired by the existing certified cache recovery.

## Evidence and resource boundaries

- Replay the original asset-bound wallet evidence and exact funding anchors before planning. Verify cached body hash, signature, slot, block time, successful supported transaction layout, wallet account reference and non-future fetch time. Replay the projected complete input before persisting any changed checkpoint.
- Add at most **three pending bodies per window across three windows per turn**, with **32 pending-reference probes**. The existing marker-recovery lane retains its separate 96-lookup ceiling. Claimed available bodies are also revalidated within the existing 64-record bound. These are bounded local database reads, not new provider allowances.
- Keep the existing direct-wallet capacity, full one-hour window, real older boundary, finalized/timed references, three-page/twelve-body window limits, 250 KB body and 900 KB combined-body bounds. Sample-capacity flags remain blocking. Available cache data cannot certify missing archive boundaries or oversized windows.
- Apply valid cached work in one wallet's window even if another wallet's archive remains source-limited, provided the whole input remains within the existing sample bounds. The remaining failure stays visible and blocking.
- Preserve candidate/evidence hashes and observation times, holder snapshots, profiles and research cohorts. Only funding checkpoints, derived work summaries, existing attempt scheduling and measured run records advance. `attempted_at` records local checkpoint adoption, not a new on-chain observation.
- Require a subsequent fresh full wallet snapshot and every unchanged eligibility gate. The fresh source path still checks the cluster; cache-only progress does not claim fresh RPC or market evidence.

Each checkpoint update compares its original hash and checks the current candidate evidence hash, unexpired owned lease and unpaused control. A changed checkpoint, candidate or owner prevents overwriting it. Independently valid earlier checkpoint advances can survive an interrupted multi-window turn. The final work/run/attempt/schedule receipt uses an ownership/source/pause-guarded [D1 transaction batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch); an owner replaced before that batch cannot claim successful progress or alter its replacement's schedule.

Cache-only work reserves no RPC, wallet-catch-up or reader-recovery quota. It can run when source allowances are exhausted, without replenishing any counter. The existing enable, contender/age/risk, pause, lease admission and source-backoff checks still apply. A successful cache turn does not clear the retained source error or refresh source `last_success`. A one-minute follow-up allows bounded remaining cache work; there is no new timer or scheduler.

## API and operator UI

The existing wallet-plan response adds `cached_funding` and permits its zero request estimate. Data status distinguishes saved evidence from source-based work, shows stored window progress, and retains the requirement for fresh full evidence. Request estimates remain lower bounds; unprobed bodies and additional pages do not become promises of completion. The read-only local checker validates the zero-RPC stage.

Regenerating OpenAPI exposed an older documentation problem: seven attention/export/authorship/duplicate-evidence routes had descriptions only in the generated output. Their unchanged descriptions now live in `openapi-attention-paths.json` and are included by the generator. All **87 existing paths** remain; repeated generation is stable. The runtime-generated content-operations schema also catches up with the already implemented authorship/duplicate counters. No endpoint or authorization behavior is added by that contract repair.

## Observed local result

The read-only checkpoint at `2026-10-20T23:42:17.758Z` (21 October, 10:42 AEDT) retained **0/10 eligible**, one new-snapshot plan and ten source-limited plans, with no qualifying cache-only work in that current sample. Four original wallet snapshots replayed. Wallet usage was **771/800**; no validation script forced a source refresh or used provider requests. The normal collector continues within its existing allowances.

Positive adoption is verified in isolated tests using an existing recorded v1 funding transaction, not by inserting examples into the main local store. A separate explicitly synthetic multi-window exercise consumes seven cached bodies in three bounded turns (3/3/1) while the creation wallet's missing archive boundary remains blocking. All original candidate observations remain unchanged. This feature does **not** establish a live eligibility gain or achieve the ten-token goal.

The local runtime reloaded the changed modules. An independent watchdog observation briefly recorded an unreachable API during reload/load, then returned to a recent degraded observation with no restart recommendation. The retained wallet RPC issue remains visible. This is not an uptime or provider-recovery certification.

## Validation and remaining work

The full discovery regression run passed **697 tests across 45 files** before the final additional window-bound assertion. Final targeted checks passed **94 tests across four files**, including all **22 cache-only tests**, funding work, reader recovery and wider capacity. Discovery UI tests passed **55 tests across eight files**. Both typechecks and the App build/performance budget passed. Home startup remains **234.1 KiB gzip across eleven chunks**, below the unchanged 250 KiB budget. The build's existing dependency annotation warnings are non-fatal.

The live cached checker replayed four original wallet snapshots and confirmed the unchanged active policy and provider caps. Final operations verification found a recent heartbeat, fresh independent observation with no restart recommendation and three retained election replays; the wallet source issue remains. Security checks denied fifteen private-file requests, passed ten admin/origin/body checks and retained signed action-session requirements. These checks made zero provider requests. Repeated OpenAPI generation produced the same hash and retained every existing path. `git diff --check` passed.

Tests exercise read-only planning, recorded v1 body and marker adoption, zero provider/global/wallet/catch-up usage, exhausted budgets, unchanged eligibility and source errors, pause/backoff/current-contender guards, wrong hash/signature/slot/wallet/time/future/failed bodies, source-boundary and twelve-body failures, bounded multi-turn work, checkpoint/source/lease races and ownership replacement before the final receipt. Browser review verifies the actual Data status counts, new explanation and continuing evidence requirements. No wallet or operator credential was entered.

No schema migration, new configuration, dependency installation, policy activation, source allowance increase or deployment. The unrelated Network snapshot work remains excluded. Next: additional certified transaction/source coverage, current fresh complete evidence and the ten-token target. Provider credential rotation and the other release gates remain open.
