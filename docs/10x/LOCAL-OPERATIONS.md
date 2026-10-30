# Local operations controls and diagnostics

Implemented on `codex/10x-operations-controls`, based on #104. These are isolated development/QA controls, not production activation or signing authority. No remote resources, provider credits, mainnet transactions or public access are created. The expired phone-QA session remains stopped.

## Setup and status

Apply migrations to the intended local database before starting this build. Additive migration `0015_local_operations_controls.sql` creates the four controls, immutable control receipts and a fenced operations heartbeat. Default controls preserve the existing local behavior. Launching, funding and claims remain disabled by the application; no control endpoint can enable them.

For the regular preview:

```sh
pnpm --dir meme db:migrate
pnpm --dir meme operator init
pnpm --dir meme dev:worker
pnpm --dir meme operator status
pnpm --dir meme operator status --check
```

The existing `MEME_OPERATOR_TARGET=restricted-qa` profile selects the saved QA database/operator token and loopback port 8799. Apply migrations 0014 and 0015 to that isolated database before resuming supervised QA. This implementation replayed them only in fresh test storage; it did not modify the saved user QA database or operator token.

`GET /api/meme/operator/operations/health` requires the local operator token and a loopback hostname. It is denied by both the restricted gateway and Worker QA allowlists, including for invited users. Responses are private/no-store. The report uses eight SELECTs; it reads counts and safe timestamps, not job payloads/errors, source cursors, provider approval text, transaction plans, credentials or wallet addresses. Aggregate scans can grow with retained history; fixed output/query count does not certify constant CPU or D1 billing.

The report includes:

- Current pause versions, the latest fenced tick heartbeat, queue/blocked/overdue counts and active/expired leases.
- Source-run counts, pending corrections and original allowance ceilings/usage/remaining credits. Reading or resuming never resets consumed usage.
- Current round freeze metadata and published-score time; ambiguous or unfinalized transaction counts.
- Stable alert codes and explicit unverified production gates. Cached/observed ownership is not certified finalized-chain evidence.

Heartbeats are sampled at most once per ten seconds to avoid per-step write amplification. Safety controls are read fresh for every action; job leases track individual work. Local alert defaults are two minutes for runner/queued-job/submitted-transaction staleness and five minutes for score freshness. They are returned as `localThresholds`; they are diagnostic defaults, not approved production SLAs. Future-only jobs do not require a runner yet. An intentionally paused runner is distinct from a missing/stale runner. A queued collector without enough Helius allowance reports its blocker, while unneeded zero Pyth allowance does not falsely label that collector as stalled.

`status --check` returns **0** for local `ok`, `idle` or intentional `paused`; **2** for `attention`; **1** for request/configuration/contract failures. Zero is not production readiness: `productionReady` is always false and financial actions remain false. No monitor, notification channel, cron or on-call rota is installed by this command.

## Independent controls

```sh
pnpm --dir meme operator pause participation "Supervised QA break"
pnpm --dir meme operator pause operations "Pause background steps"
pnpm --dir meme operator pause collection "Hold provider collection"
pnpm --dir meme operator pause serving "Pause public API reads"
pnpm --dir meme operator resume participation "Resume supervised local QA"
```

| Control | Stops | Recovery remains available |
| --- | --- | --- |
| `serving` | Public launchpad API GET/HEAD reads in the local participation runtime | Auth/logout and private operator routes. Static/cached HTML is separate; stop the gateway to remove public exposure. |
| `participation` | New votes and vote changes, including direct calls to the voting function | Existing committed vote replays remain read-only. The UI shows Voting paused and disables vote controls. |
| `operations` | New automated round/score/settlement steps and job claims | Private inspection, reviewed preparation/retry requests and resume. The runner retains checkpoints and reports paused heartbeats. |
| `collection` | New source runs/pages and new provider reservations for history/prices | Already accepted evidence and cached prices; ready-run read-only replay; unchanged budgets/cursors. A stopped CLI collector must be restarted explicitly. |

Controls do not replace independent serving, participation, launch, funding and claim authorization in a future production system. They cannot revoke a signature, reverse a transfer or pause funded direct Jito on-chain claims.

## Lost responses and concurrent changes

Every change requires a short reason, expected control version and unique retry key. A compare-and-swap update, immutable receipt and audit entry commit together. Conflicting versions fail with 409. Reusing a key with changed intent fails; a retry cannot overwrite another operator's newer decision.

Before sending, the CLI saves the non-secret request in the target's ignored `control-requests/` directory and prints its path. Its envelope binds the local profile, origin and worktree; retrying in another target/worktree is rejected before sending. Use a brief operational reason without credentials. If a response is lost:

```sh
pnpm --dir meme operator control-retry /absolute/path/to/saved-request.json
pnpm --dir meme operator status
```

Retry the same file unchanged. The response distinguishes the accepted historical `change` from the **current** `control`. Replaying an old pause receipt after a later resume reports both; it never re-applies the old pause. Do not blindly rewrite expected versions or issue a financial retry to resolve an unknown transaction.

Operator transport accepts exact loopback operator routes, does not follow redirects, bounds successful responses to 512 KiB and suppresses raw error bodies. General CLI failures report the HTTP status; inspect private status/audit records for diagnosis. Bearer tokens stay out of URLs, saved control requests, status reports and terminal output.

## Pausing, draining and rollback

A pause prevents a new bounded step. A step/provider request that started before the pause can finish, retaining its accepted evidence and consumed allowance. Pausing between job claim and execution releases that lease back to the same queue entry; resuming uses its existing identity/checkpoint.

`operations.draining` identifies currently valid outstanding job leases while operations are paused. It is not a count of all in-flight network requests or proof that an expired/hung worker exited. Inspect expired leases and stop runners before maintenance. Older tick completion/start records cannot overwrite the newest heartbeat.

For an emergency local stop, pause the affected controls, stop the CLI runners, and run the private QA session's existing stop script if exposure exists. Verify processes have stopped before restoring an older application build. Builds preceding migration 0015 do not enforce these controls. Retain additive tables, immutable records, evidence and consumed provider usage; an application rollback must not rewind the database or quotas.

## Verification

Local checks cover lost responses, old-receipt replay, concurrent versions, quota preservation, blocked provider calls, pause-between-lease-and-execution, explicit stale/freeze/budget alerts, redaction, read-only status, missing configuration and heartbeat fencing. CLI tests cover loopback/path restrictions, redirects, oversized bodies and exit codes. Desktop/mobile browser journeys cover visible participation pause alongside the existing identity/voting/history flows.

The Linux CI workflow also creates an empty disposable operator profile, starts the actual local Wrangler Worker, and runs `operations:probe` plus the real CLI `status --check`. The probe requires explicit disposable CI flags, checks an empty/non-financial baseline and tests all four controls, idempotent retries, real D1/HTTP behavior and unchanged zero allowances. Never run it against saved user QA state. No public authentication bypass or financial endpoint is added.

The one-year read benchmark still uses 365 campaigns/3,650 entitlements. Fresh serving/participation checks add two fixed control reads to Today polling and one to paged rewards: the compact payload is 1,278 bytes versus 1,546,276 for legacy state, a 99.917% reduction in this local fixture. Startup remains 69.0 KiB gzip within the 80 KiB budget. These are local measurements, not production capacity or physical-wallet certification.

Next gates remain [real-wallet QA, complete live evidence, approved economics/actual custody, mainnet execution, alert delivery/rota and separate production authorization](DELIVERY-STATUS.md). Existing provider caps, products and financial commitments are unchanged.
