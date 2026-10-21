# Local supervisor vacancy recovery

22 October 2026 (Australia/Sydney). Implements an F5 recovery correction from the [daily product plan](82-next-product-functionality-plan.md), alongside ongoing F1 coverage and F3/F4 qualification work. No provider, Worker, UI, database schema or deployment changes.

## Reproduced failure and correction

The old supervisor correctly left a healthy **unowned** launcher alone. But if that service later failed, `watchdogDecision` returned `report_unowned` and the observation loop never returned to startup admission—even after port 8794 became free. The workstation could remain without a local preview until someone restarted the supervisor. At initial startup, an unhealthy occupied port could also waste the supervisor's launch attempts on the launcher's existing port-preflight refusal.

`scripts/discovery-supervision.mjs` now owns the testable supervisor loop, while `scripts/supervise-discovery.mjs` retains its existing filesystem lock, log, hidden launcher command and fixed loopback transport. After at least three consecutive restart-worthy checks of an unowned service, a **successful loopback bind/close vacancy probe** permits return to startup admission after the existing fifteen-second recheck. An occupied/unavailable port keeps the supervisor observing, without starting another launcher or terminating its owner. Initial startup also checks vacancy before consuming a launch attempt. The launcher's original port preflight remains in place for the later race; the probe is not a process-ownership certificate or a reservation across startup.

Related ownership/shutdown corrections:

- Track `exit` and `error` events on the exact spawned `ChildProcess`, plus its exit/signal state. A signalled exit is no longer mistaken for a live child because `exitCode` remains null. An asynchronous spawn error no longer lacks an error listener.
- Retain a still-running owned handle after requesting termination; only observed exit releases it. Failed termination cannot cause a second launcher to start or allow a stale PID-only reference to be treated as a new owned process. Unowned processes are never passed to termination.
- Count synchronous and asynchronous failed starts against the same three-attempt rolling fifteen-minute allowance. Use monotonic elapsed process time for this in-memory allowance, so changing the wall-clock date cannot replenish it. This does not change provider UTC-day accounting, persist a new restart ledger or reset any current allowance.
- Keep the existing sixty-second boot grace, thirty-second checks, three consecutive watchdog failures and fifteen-second cycle recheck. A recent timer with source degradation, provider backoff, quota exhaustion or pause still does not request a restart.
- Shutdown cancels supervisor waits and bounded loopback HTTP requests. Every asynchronous health/port/observation boundary checks shutdown before admitting another launcher. The health read now uses the existing 64 KiB bounded JSON reader, manual redirects and no-store semantics. Watchdog routes, authentication, report format and publication behavior remain unchanged.

## Fault and live-read verification

**Nine new supervisor tests plus twenty-three existing archive/migration/launcher/watchdog tests pass (32 total).** The new tests cover a real ephemeral loopback port, a healthy unowned listener becoming unreachable while still occupying its port and then closing, occupied-port startup refusal, interrupted consecutive failures, failed termination, signal exits, synchronous/asynchronous spawn errors, rolling start admission, stop races and natural subprocess shutdown during a real pending startup wait.

The unowned-listener fixture stays occupied through the first four failed checks; only after it closes and the fifth failure does the fifteen-second recheck return to one admitted start. Only that newly owned fixture launcher receives termination during cleanup. Restart tests reject a fourth start inside any fifteen-minute window, including failed spawns. A forty-eight-hour **simulated** watchdog-report sequence exercises more than 5,000 source-degraded/healthy checks without a restart; the existing watchdog tests separately validate recent paused/budget/backoff reports. This is not an actual forty-eight-hour provider outage or an uptime certificate.

The real subprocess test exits naturally after shutdown aborts its pending sixty-second wait and closes its own disposable Node child. Tests use no Wrangler instance, real collector, production port, source provider or database adoption. Syntax checks pass for the bootstrap, engine and tests.

Read-only `scripts/check-discovery-operations.ts` passed against the existing local service: heartbeat **2026-10-21T15:04:29.461Z**, fresh independent check **15:04:45.417Z**, timer recent, operational state degraded only by `market_source_issue`, and `restart_recommended=false`. Three retained election rehearsals replayed (442 / 364 / 363 candidates), with no retained election error, signing or launches. The check made zero provider requests. Original historical cohort/source/holder/wallet/cache hashes remain identical and foreign keys pass; the thesis-only built-artifact assertion also passes. No application build/UI suite is repeated for this Node-only change.

## Activation and remaining boundaries

**No running supervisor or launcher was restarted to load this change.** The new engine loads on the next ordinary supervisor process start. The existing preview remains on its established store and scheduled task; its current in-memory start allowance is not discarded to force activation. This work neither installs a task nor claims a live fault injection into that service.

The underlying intermittent Wrangler/ProxyController transport failure is still unresolved. This fixes a deterministic recovery hole around it; it does not establish its root cause. Real long-duration outage/rollover rehearsals, cross-process restart-ledger persistence, safe archive operational adoption, multi-day storage growth and approved retention remain open. Existing source budgets, pause/backoff, leases, evidence/action/election gates, frozen v4 and thesis-only production closure remain unchanged. No deploy, forced refresh, quota reset or data deletion.
