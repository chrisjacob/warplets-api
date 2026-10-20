# Local partial-launch recovery exercises

21 October 2026. Advances PRD §§6.6, 11.1, 17.3 and 18 / P4–P7 with an inspectable offline failure model and immutable saved exercises. This is **not a production launch executor or durable step journal**. The user's free-first, local-only, unchanged-evidence-gates and no-deploy instructions control execution.

## Implemented

`/launch-recovery` provides four editable browser presets: lost response/restart, missing critical lock verification, disappeared transaction evidence and changed configuration. Browser computation makes no provider requests; authenticated operators can save/replay a scenario from `/admin/10x#launch-recovery-lab`. Downloaded evidence includes the frozen input, result and, when saved, record hashes. Public summaries omit input JSON and operator review reasons.

Each exercise contains synthetic edition/transaction aliases, an assumed configuration fingerprint and four explicit assumed preflight checks: frozen winner, simulation passed, funded budget and viable same-chain $10X. These booleans are **not real eligibility, funding or launch proofs**. No existing discovery gate or system capability is changed by an exercise.

The model covers ordered token creation, native pool, OG pool, same-chain $10X pool and position locks, followed by independent deployment/lock/fee-rights checks and a modeled announcement. It separates a mock source transaction ledger from a job journal. Both are in-memory objects during evaluation; a simulated restart retains them and invalidates observation freshness. The saved database record freezes the **entire exercise**, not each execution step as it occurs.

The model enforces:

- Stable `edition_alias/step` keys across restart and changed configuration. A new fingerprint cannot silently create a new mint identity; configuration conflict remains held even if a later event proposes the original fingerprint.
- Recorded intent and fresh mock-source reconciliation before submission. Duplicate work and an acknowledged or unacknowledged existing transaction do not authorize another submission.
- Lost-response recovery by finding the same finalized mock receipt. A lost acknowledgement alone is recoverable; disappeared or contradictory source evidence requires manual recovery.
- No automatic pending-transaction retry. An explicit retry is considered only after an assumed definitive failed transaction with no effect, a new reconciliation and the existing two-attempt bound. Both attempt receipts remain inspectable.
- Configuration/resource agreement, ordered dependencies and fresh observation of prior steps before advancing. A transaction's finalized status alone does not establish correct deployment identity.
- Pause/resume and restart invalidate prior readiness/critical verification. Abort is terminal for mutations. Existing effects and transaction history remain; no withdrawal, unlock, receipt deletion or mint rollback event exists.
- All five finalized steps plus separate deployment, permanent-lock and fee-rights assumptions before a modeled announcement. Duplicate announcements are suppressed. Subsequent missing evidence invalidates modeled ACTIVE status without erasing historical effects or an earlier modeled announcement.

**Trust boundary:** if an assumed definitive failure later becomes finalized after a retry, the exercise can expose **two mock effects** and enters manual recovery. It does not claim to prevent this under contradictory source assumptions. A real adapter still needs certified finality, transaction validity/expiry and canonical resource/absence checks before retrying. No real source proof or blockhash reconciliation is implemented here.

Result states and counters are explicitly **modeled**. Even a modeled ACTIVE result has `launch_enabled=false`, `signing_enabled=false`, `publishing_enabled=false` and `chain_evidence_verified=false`. No real spotlight, token, pool, lock, signature or announcement is created.

## Storage and API

Local migration `0030_launch_recovery_lab.sql` adds an immutable exercise table with update/delete rejection triggers. It was applied only to the existing local D1 preview store, with `--local` and the existing `.wrangler/local` persistence directory. Remote bindings remain disabled; no deployment or remote migration was performed.

The new endpoints are:

- `GET /api/10x/launches/recovery-lab`: latest five replay-checked summaries.
- `POST /api/10x/admin/launches/recovery-lab`: authenticated local save and deterministic replay.
- `GET /api/10x/admin/launches/recovery-lab/:id`: authenticated full input/result retrieval.

Existing local-runtime, bearer authentication, browser-origin and bounded JSON guards apply. Each request requires a UUID and review reason. A repeated UUID/body returns the original record, including at the quota; conflicting UUID reuse returns 409. Ten new recovery exercises per UTC day are admitted atomically, independently of the existing twenty mathematical lab records. Normalized requests are capped at 16 KB and input-plus-result at 100 KB. One exercise has at most 80 events, five steps and two attempts per step.

Inputs, results and metadata are hashed separately. Retrieval replays and compares the complete deterministic result; an independently rehashed false result still fails replay. Exercise admission and its immutable audit row share one database batch, so a failed audit insertion does not leave an unaudited exercise.

## Verification and local receipts

- **598 discovery tests across 43 files passed**, including 33 new recovery tests: before-retry reconciliation, source/acknowledgement distinction, pending receipts, explicit bounded failure retry, late contradictory attempts, configuration/resource conflicts, order, independent critical checks, pause/abort, retained effects, restart freshness and duplicate announcements.
- Persistence tests cover exact idempotent retry, conflicting concurrent UUIDs, atomic daily admission, audit failure rollback, update/delete denial, redaction, tampering, actual database close/reopen and maximum transcript bounds. Route tests cover local-only/authentication/origin/content-type/body limits and private full-input reads.
- Local lost-response record **`1d0e5791-3830-4f8c-a4c3-6bc450d75b7c`** replays with one mock token creation, five total mock submissions/effects and one modeled announcement. Missing-lock record **`2ffa99f8-b443-42e1-a8f2-e3e1feca5074`** preserves all five effects but holds the announcement at zero. Both save/retry/replay identically; unauthorized full reads return 401.
- The existing v5 timed mathematical rehearsal and all four preceding retained mathematical records replay unchanged. Active discovery policy and disabled financial/publication capabilities were checked unchanged.
- Local security checks passed: fifteen private requests denied, ten admin origin/body checks, public routes available and signed action sessions required. The new exercise smoke checks, old mathematical smoke and security checks made zero source/provider calls.
- Browser review through the existing tunnel verified local recomputation of the missing-lock failure, its unchanged one-token/five-effect history and zero modeled announcements. The result explicitly distinguishes all modeled counts from zero actual launches/publications.
- Discovery/app typechecks, app build, startup-size budget and existing navigation tests passed. Home startup remains 233.9 KiB gzip; the new recovery chunk is 19.62 KB / 6.82 KB gzip. The recovery page and admin editor load lazily; they add no eager signer or source client. OpenAPI now has **80 paths**; the mathematical lab summaries were updated to describe all five existing versions accurately.

Useful commands from the repository root:

```powershell
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app build
pnpm --dir app test -- src/discovery/navigation.test.ts
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-launch-recovery-local.ts
pnpm exec tsx scripts/check-launch-timed-local.ts
node scripts/check-tenx-security-local.mjs
git diff --check
```

The new smoke script reuses two UUIDs in ignored `.tmp/launch-recovery-local.json`; repeated checks consume no additional admission slots. No new source, dependency, timer, signer, secret or external alert destination was added.

## Remaining work

Real adapter interfaces and canonical resource identities, durable per-step write-ahead execution state, verified chain reconciliation/finality/expiry, secure signer policy, actual lock/fee-owner proofs, configuration certification and devnet fault receipts remain open. Single-active-spotlight enforcement across real launches, full voting/settlement fault testing, actual announcement delivery and external alert escalation are not established by this model. D08–D10/D14–D16/D18 stay open. Existing curve/fee/cycle simulations are separate from this assumed-preflight workflow exercise.

No launch, signing, spending, reward credit, social publication, deployment or evidence-gate relaxation occurred. This milestone does not improve discovery coverage or claim the ten-eligible-token target has been reached.
