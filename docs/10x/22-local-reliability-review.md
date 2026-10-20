# Local discovery reliability and independent checking

20 October 2026, Australia/Sydney. This implements the discovery portion of P4 in the [PRD task map](19-prd-task-map.md). Free services and local operation only; feature-branch commit/push, no deployment. The evidence gates, numerical thresholds, source allowances and financial capabilities remain in force. The ten-eligible-token target is still open.

## What changed

The existing supervisor used to check only `/health`. A working API could therefore hide a stopped collection timer. The supervisor now independently reads `/api/10x/system/operations` every 30 seconds, in its separate process from the launcher/timer. It computes heartbeat age itself, rather than accepting an API-ready flag as proof of collection. Its HTTP targets are fixed loopback routes, responses are bounded to 64 KiB, timeouts are five seconds, and redirects are disabled.

A missing, future or more-than-20-minute-old heartbeat, unreachable API or invalid operational response counts toward three consecutive failures. Only the supervisor's own child launcher can be restarted. A responsive unowned service is observed without being terminated. Starts are limited to three per rolling fifteen minutes in that supervisor process, with a cooling period and continued checks afterward. Pause, provider backoff, exhausted quotas and other degraded source states do not request a timer restart. The threshold accommodates the existing bounded sequential collector work; it is not a one-minute outage-detection promise.

The checker writes its latest observation to ignored `.tmp/discovery-watchdog.json`, logs transitions to the existing local supervisor log, and sends a small authenticated observation to the local Worker. Migration `0017_operations.sql` stores the latest monotonic observation and transition-only history. Retries and out-of-order observations cannot replace the latest observation or manufacture duplicate transition entries. Reports must be within two minutes of receipt and cannot have a future timestamp; restart flags are validated against the report code. Public reads expose no credential or write capability. [D1 batches commit these paired writes transactionally](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

The Data status page displays heartbeat state, the independent observation's age, collector due/running/backoff/budget states, source issues and retained abandoned jobs. The independent observation is separately labelled missing/stale after two minutes. It does not certify full source coverage, eligible tokens or financial readiness. Checks and observation writes make zero market/RPC provider calls. Local workload and storage still require profiling before any remote release.

Expired discovery attempts are now marked failed with `lease_expired_without_completion` when a new owner acquires the lease, preserving evidence and their original start times. A resumed request checks current ownership before continuing material work, and job finalization cannot overwrite another owner's attempt. These checks cover discovery ingestion; they do not claim a universal transaction protocol for future launch or reward workers.

The fault exercise also exposed a freshness defect: future risk and market observations could pass the corresponding age comparisons. Those existing freshness gates now reject future risk times, market fetch times and provider observation times. Thresholds and policy values were not loosened or automatically activated. Valid historical frozen inputs replay as before; actual-time election replay already rejects future evidence.

## Fourteen-day offline exercise

`discovery/src/reliability-14d.test.ts` uses the production discovery, quota, lease, election, outcome-review and eligibility functions against an isolated temporary SQLite database with the local D1 adapter. All transaction/account responses are explicitly synthetic. No example is inserted into the running local database and any unexpected real fetch fails the test.

The fake-clock scenario spans fourteen days and 336 hourly ticks, with a duplicate delivery at every tick, a 48-hour simulated 429 outage and persisted Retry-After, deliberately small daily quota ceilings, intentional pause/resume, stale/future evidence, an abandoned lease, and an actual database close/reopen. The original proof records and daily snapshots survive restart and changing current state. A separate test suspends a request across lease replacement and verifies that it cannot continue publishing or finish the new owner's job.

Observed deterministic result:

| Check | Result |
|---|---|
| Simulated days / hourly ticks / duplicate deliveries | 14 / 336 / 336 |
| Successful / failed / paused, backoff or quota-skipped cycles | 46 / 36 / 254 |
| Simulated provider requests | 168; all method-allowlisted reads |
| Real provider requests | 0 |
| Daily immutable rehearsals / matching audit entries | 14 / 14, no duplicates |
| Provider outage | 48 simulated hours; recovery verified |
| Database reopen / abandoned-job recovery | Passed |
| Quota overshoot / invented eligible winner | None |

The script writes the ignored `.tmp/discovery-reliability-14d.json` report and can be rerun offline. Quotas in this test are intentionally smaller than the unchanged configured local service limits so exhaustion is exercised quickly. Synthetic candidates remain unqualified when holder, wallet or market evidence is absent.

This is **not completion of PRD §17.6 in full**: live voting, campaign settlement, replayable mainnet financial execution, fourteen days of actual workstation uptime and external alert delivery remain untested/unimplemented. The PRD requires at least two external alert channels; D18 is still open. The checker and service share one workstation and cannot notify elsewhere during host sleep, power loss or supervisor failure. No new external messaging destination, scheduled task, credential or paid service was configured.

## Local operation and verification

The existing verified supervisor/launcher tree was restarted to load the checker; startup reuses the same local database and existing scheduled-task setup. It does not clear quotas, override pause or erase provider backoff. The named local tunnel remains the preview path. At 21:27 Sydney time the checker retained a healthy observation; the smoke check confirmed a recent independent observation and timer, no operational issues, unchanged policy/quotas and three successful historical rehearsal replays with zero provider requests.

All 226 discovery tests passed across 26 files, including six operational tests and the long-running simulation; all six independent Node watchdog tests passed. Discovery typecheck and the app build/performance budget passed. Generated OpenAPI documents public reads and the protected report endpoint. The cache-only operations smoke check verifies heartbeat/watchdog freshness, active policy and quota ceilings, and replays retained election snapshots.

```powershell
pnpm --dir discovery test
pnpm --dir discovery test -- src/reliability-14d.test.ts src/operations.test.ts
pnpm --dir discovery typecheck
node --test scripts/discovery-watchdog.test.mjs
node --check scripts/supervise-discovery.mjs
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-discovery-operations.ts
# From discovery/, local only:
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
```

Next PRD work: signed Solana wallet linking without votes or signer custody (P5), continued source-path certification (P3), and full voting/settlement fault coverage once those modules exist. Remote alert recipients, production release, token economics and launch/treasury authority remain separate founder decisions.
