# Protect Solana cross-check opportunities within the existing hourly ceiling

23 October 2026, Australia/Sydney. Continues [181](181-older-runner-historical-proof-and-coverage.md). No deploy.

## Delivered allocation

The four-chain least-recent-attempt rotation can put four hours between Solana batches while DEX corroboration expires after two hours. Solana proof intake, candles and traders all require that fresh corroboration. Add `attention-solana-allocation-v2` to the existing selector:

| Existing UTC hour | Preferred eligible work | Ordering |
|---|---|---|
| Even: 00, 02, ..., 22 | Solana | Least-recent token attempt, then original queue position |
| Odd: 01, 03, ..., 23 | Other supported chains | Least-recent chain attempt, then least-recent token attempt; original queue position breaks ties |
| Preferred group has no pending eligible identity | Lend the same opportunity to the other group | Original v1 ordering |

Eligibility still requires fresh attention, non-adverse status and no currently fresh market cross-check. All at-most-100 returned identities remain available; no global-top20 cutoff or upper token-age ceiling returns. Exact chain/contract identity remains mandatory. Failed, pending and empty attempts count in token/chain fairness. Attempt history stays bounded to 25 original reservations in 24 hours.

With all four groups continuously pending, the declared allocation is **12 Solana / 4 BSC / 4 Base / 4 Robinhood batches per UTC day**, within the same **24 total hourly opportunities**, each at most 20 addresses. Fallback can redistribute these shares when a group has no work; the shares are not separate allowances. The phase comes from the queue cutoff's UTC hour, including midnight, rather than invocation count or workstation timezone.

`attention-review-YYYYMMDDHH` identities, original reservation/transport paths, shared 600/day market limit, provider pacing, one-flight lease, pause/backoff and admission controls are unchanged. A dispatched failure stays spent. Fallback only handles absent preferred work before dispatch; it never replaces a failed/empty response. No additional timer, source request, migration, dependency or configuration change.

Keep the exact original `attention-fair-followup-v1` policy and selector unchanged for historical replay. Only the current entry point uses the new allocation and reports its version. Do not reinterpret original saved allocations under v2 or change their receipts.

## What this fixes and what remains uncertain

This protects a nominal two-hour Solana batch cadence while retaining opportunities for the other chains. It does **not** guarantee every Solana identity is fresh, continuous freshness under variable dispatch latency, successful provider responses or workstation uptime. There is no latency margin at the existing two-hour boundary. More than 20 pending identities need multiple batches; token fairness distributes the opportunities. Other chains intentionally receive a slower nominal cadence and can be stale between turns. Missing, late, adverse or failed evidence still holds downstream work.

The unchanged 7,200-second gate expires a market observation one millisecond after its boundary. Candle/trader selection remains blocked then. No scheduler metadata supplies quality evidence. Canonical/historical proofs, holder acquisition/retention, organic-flow checks, grades, candidate admission and launch/action gates are unchanged. Production remains thesis-only, with [149's combined Free-serving/storage/CPU/recovery acceptance](149-native-builder-and-combined-free-budget.md) still a release blocker.

## Actual retained evidence versus simulation

A consistent **read-only 06:27:16 UTC** snapshot returns 100 identities: 38 Solana / 29 BSC / 10 Base / 23 Robinhood. Fresh DEX checks: **0 / 0 / 8 / 20**, respectively. Both display and collecting views disclose truncation. The original 06:00 UTC hour was already spent on a successful 20-address Robinhood batch reserved at 06:11:55, before this change. It remains closed; no engineering collection or replacement was made.

At that captured cutoff, both v1 and v2 would select the same 20 Solana identities if a slot were available: 18 below global position 20, 11 with positive provider-reported opening age over 24 hours. That is a **counterfactual selection**, not an executed allocation, new acquisition coverage or proof of token age. Current-hour admission correctly prevents dispatch. Ordinary post-change successful coverage is still unverified; observe future naturally due hours without reopening old work.

The audit verifies eight original cross-check receipts' request/receipt/response hashes and retains their normalized bodies, the exact queue/attempt inputs and both selections. A file-only selector replay matches the frozen selections. Private inputs: `.tmp/solana-allocation-audit-182-001/inputs.json`, SHA-256 `6e7bf00406f09ba226565d2059ee645952893f2c8a60bdbf79e65727a7cbf8e6`; result SHA-256 `61dbab08b5bd325aefda8a08726e95c7e31f809b5fe7e7069179290e8aa1a207`. Hashes protect retained integrity, not independent provider authenticity. No provider calls or database writes by the audit.

A separate **synthetic ideal-success** 24-hour model holds 98 fresh attention identities, including 38 older-reported Solana identities below the global head, and crosses UTC midnight. Both policies use exactly 24 requests of at most 20 addresses. V2 allocates 12/4/4/4, reaches all 38 Solana identities and has fresh Solana targets at every half-hour probe; v1 has zero-coverage probes. These are deterministic scheduler/expiry checks, not observed uptime, live token quality or proof of future success. Separate missing/late-response tests explicitly preserve zero fresh coverage and blocked candle/trader work.

Original checkpoint 181 evidence still replays exactly: 18 source receipts, 17 successful reviews, one canonical state receipt, two complete historical turns and one spent `rpc_unavailable` turn. Historical cost remains 13 charged attempts; no creation/migration pair or candidate admission is established. Original database row digests and foreign keys pass. Frozen artifacts and unrelated Network/legal work are preserved.

## Verification and next work

Focused regression: **89 tests / 7 suites**, including allocation, queue, candle/trader, canonical and historical gates. Full Discovery regression: **1,688 tests / 116 suites**. Backend/app typechecks, closed build/performance budget (227.8 KiB gzip / 11 startup chunks), security preflight and thesis-only guard pass. The full run uses the handover's 30-second CLI allowance with two workers; repository test configuration, assertions and runtime deadlines remain unchanged. No UI change or new production CPU/serving acceptance claim. Current Workers guidance and published 5.20261023.1 declarations were consulted without dependency upgrades.

Existing Worker health returns 200/ready after the initial contended timeout; Vite returns 200. The relay's unauthenticated probe returns 401, establishing reachability only. No manual restart, collection, migration or deploy.

1. Observe ordinary post-change Solana/other-chain successes and failures, fresh identities and downstream proof/trading targets over multiple hours. Keep latency gaps, truncation, misses and charged costs explicit; do not claim live recovery from the model.
2. Improve exact historical-event targeting for declared future cohorts using quieter canonical addresses or exact provider transaction hints, then validate actual instruction bodies. Keep the original failed third turn spent; do not enlarge blind scans or substitute named examples.
3. Demonstrate historical pairs across the declared cohort before separately versioned older-runner admission, qualified holder acquisition/retention and meaningful flow. Complete authoritative already-launched ATTN exclusions and prospective founder usefulness while preserving all Free/evidence/action gates and release blockers.
