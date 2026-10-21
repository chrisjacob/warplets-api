# Durable local supervisor restart allowance

22 October 2026 (Australia/Sydney). An F5 reliability follow-up to [supervisor vacancy recovery](93-supervisor-vacancy-recovery.md) and the [daily product plan](82-next-product-functionality-plan.md). The existing three launcher starts per fifteen minutes now survive supervisor process replacement. No Worker, UI, provider, research-admission, database or production configuration changes.

## Behavior

Previously, restarting the supervisor discarded its in-memory start history. `scripts/discovery-restart-budget.mjs` now provides the admission dependency used by `scripts/supervise-discovery.mjs`. The pure supervisor engine retains its existing in-memory default for isolated callers/tests; the real bootstrap always supplies persistent admission.

The fixed ignored `.tmp/discovery-restart-budget.json` stores only a version, a fresh revision UUID and an integer reservation count from zero through three. It contains no credentials, provider payloads, mint addresses or wall-clock reset dates. A start is allowed only after its reservation has been written to an exclusive temporary file, flushed, closed and atomically renamed over the ledger. Synchronous/asynchronous spawn failures and a crash after committing still consume the reservation. A failed read/write/sync/replace cannot authorize a start or refund debt.

Within one owner, reservations age independently using monotonic elapsed time and the unchanged rolling fifteen-minute rule. A new supervisor cannot prove how much time elapsed while its predecessor was absent: every saved reservation therefore receives a **fresh full fifteen-minute cooldown when first loaded for admission**. Wall-clock jumps, UTC rollover and claimed downtime cannot refill the allowance. This intentionally can delay recovery longer than the original rolling window; it cannot grant additional starts. Backward/nonfinite monotonic readings hold admission.

When no ledger exists, first adoption persists three conservative legacy reservations and witnesses fifteen minutes before admitting a start. This also prevents loss of the previous implementation's unknown in-memory attempts. No migration, counter reset, timestamp reconstruction or synthetic earlier observation is used. Healthy services and occupied/unowned ports do not access or initialize this ledger because admission is reached only after health/vacancy checks.

A per-operation exclusive `.json.lock` serializes ledger access in addition to the bootstrap's existing supervisor process lock. Each owner compares the exact previously committed revision before reserving again; another writer or external ledger deletion/replacement blocks that owner's stale state. Malformed, oversized (over 1 KiB), non-regular, linked or unreadable state is preserved and held. The control loop keeps observing, suppresses repeated identical hold logs and never logs file contents or filesystem exception details. No automatic stale-lock removal, pending-file adoption or ledger repair is implemented.

## Activation and interrupted-write recovery

**No live supervisor or launcher was restarted to activate this milestone.** It loads at the next ordinary supervisor process start and preserves the established database, task and source timer. Do not terminate a healthy owner, delete the ledger or bypass its first-adoption cooldown to force activation. Existing sixty-second startup grace, thirty-second checks, three consecutive runtime failures, fifteen-second recheck and owned-process termination rules remain.

A crash during a ledger operation can leave its exclusive guard and, before replacement, a uniquely named `.pending` file. That condition deliberately holds startup rather than guessing which reservation committed. A healthy existing service can still be observed. There is no automated repair command. For operator review, retain the ledger/guard/pending bytes, establish that every supervisor owner has stopped, and inspect the committed ledger and log before any deliberate orphan-guard cleanup. Never adopt a pending file, remove committed debt or edit the count to zero. Invalid/missing committed evidence needs a separately reviewed recovery, not an automatic restart-budget reset. No such cleanup or recovery was performed here.

Atomic replacement and flush protect ordinary process-crash behavior; this is not a power-loss/filesystem-corruption durability certificate, an access-control boundary against the workstation owner, a distributed lease or a fix for the underlying Wrangler/ProxyController transport failure. An orphan guard can require operator intervention, and repeated owner changes can extend cooldowns. These availability costs are explicit rather than hidden extra retries.

## Verification

**Forty-five local recovery tests pass:** eleven ledger tests, eleven supervisor tests and twenty-three existing archive/migration/launcher/watchdog tests. They cover rolling boundaries, first adoption, independent reservation expiry, backward/invalid clocks, ownership changes, three separate real Node processes, failed writes/flushes/replacements, malformed/oversized/linked/unreadable inputs, changed/missing ledgers, concurrent/orphan guards, and real subprocess crashes immediately before and after replacement. The supervisor fixture reserves all three synchronous failed spawns and proves that the next owner has no available slot. Healthy/source-degraded timers and occupied ports never call admission; a ledger failure keeps checking without spawning or exposing exception details. Tests use disposable paths and children, with no live service restart or provider requests.

The initial wider test attempt hit Windows sandbox `EPERM` in existing archive/migration temporary-path resolution. The same suite passed outside that sandbox; no application change was made for that environment failure. Syntax checks, private-credential checks and documentation links/whitespace pass. The existing built-artifact release assertion remains thesis-only; no UI/Worker build is repeated for this Node-only change.

Read-only local operations verification passed with heartbeat **2026-10-21T15:46:29.633Z**, fresh independent watchdog **15:46:28.867Z**, recent timer and `restart_recommended=false`. The only operational issue was `market_source_issue`; no restart was warranted. Three retained election rehearsals replayed (442 / 364 / 363 candidates), with no election error, signing or launches. This check made zero provider requests. The original 1,732 historical row hashes remain identical and the foreign-key check passes.

Run from the repository root:

```powershell
node --test scripts/discovery-restart-budget.test.mjs scripts/discovery-supervision.test.mjs scripts/discovery-watchdog.test.mjs scripts/discovery-lifecycle.test.mjs scripts/discovery-migration-state.test.mjs scripts/discovery-archive.test.mjs
pnpm exec tsx scripts/check-discovery-operations.ts
pnpm --dir app release:check
git diff --check
```

## Remaining work

F1 still needs the admitted prospective broad-token coverage target; F3 qualified organic volume/meaningful holder growth and F4 frozen paired held-out scoring remain unqualified. F5 still needs the underlying transport investigation, wider outage/rollover rehearsals, multi-day storage growth, approved retention/off-device recovery and safe stopped-owner archive adoption. This closes the cross-process allowance gap, not all reliability acceptance. Frozen v4, provider Free limits, pause/backoff/leases, every evidence/action/election gate and thesis-only production exposure remain unchanged. No deploy.
