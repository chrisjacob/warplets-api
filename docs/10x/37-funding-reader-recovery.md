# Bounded funding reader recovery — local checkpoint

21 October 2026. PRD §§4,14.2,17.1: improve evidence coverage under the existing free-source allowances. Continues [cached funding recovery](36-cached-funding-recovery.md) and [transaction reader support](31-transaction-v1-coverage.md). No deployment, paid provider, wallet signing, live votes or policy activation.

## Implemented

- Otherwise complete direct and second-hop pre-buy funding windows can schedule an unsupported body for a bounded recheck with the current transaction reader when there is no verified cached replacement and no receipt for that signature/reader. New ordinary terminal wallet reads record the reader immediately, preventing another recovery purchase with that same reader. Older reader receipts remain intact. Pre-existing unversioned markers have unknown reader provenance; their one permitted recheck is not proof that the earlier request used an older parser.
- Admission reserves **at most two signatures per wallet turn and twenty per UTC day**, globally across tokens and hops. These are extra restrictions inside the unchanged wallet **800/day**, global RPC **5,000/day**, catch-up subset and **18-call turn** limits, not additional allowances. Cluster checks and body requests use the same existing quota reservation, lease, pause, pacing and shared rate-limit backoff. Normal contender collection still requires verified creation within 24 hours, graduation, market floors and no known risk failure; an explicit recovery request cannot bypass that filter.
- Only windows whose sole gap is missing/unsupported bodies are considered. Recovery reads target **unsupported** markers only. Pending pages/bodies, unknown timestamps/finality, absent archive boundaries, page caps, windows beyond twelve bodies, global record/byte caps and unrelated irreparable direct windows remain blocking. Second-hop enrichment waits behind direct coverage. This conservative lane cannot solve the common archive and sample-limit gaps by retrying them.
- Before another source read, all available checkpoint bodies, saved anchors and second-hop outflows replay with exact identity, hashes, original fetch times and the unchanged decoder. Invalid caches fail closed. Source results must pass finalized RPC reading, supported-version normalization, successful transaction validation, primary signature, exact saved slot/block time and wallet-reference checks. The existing 250 KB body, 64-record and 900 KB retained-body limits apply; recovery accounting includes bodies added through checkpoints as well as the prior snapshot.
- Migration `0028_funding_reader_recovery.sql` adds immutable read receipts keyed by signature and reader version. Atomic claims bind the active wallet lease, current candidate evidence hash, exact checkpoint hash/key, saved unsupported marker and finalized reference. Second-hop instruction keys and matching legacy keys are retained separately. Claims survive crashes and cannot be deleted to obtain another attempt. Lost leases, pause, changed snapshots or changed checkpoints leave an interrupted receipt without cache publication.
- Cache publication and successful receipt completion commit together in a D1 batch. Null bodies and terminal source/layout failures retain explicit outcomes; transient errors retain a receipt and propagate existing backoff. All claimed attempts, including interrupted requests or quota failures after reservation, conservatively consume the recovery cap and are not automatically retried with the same reader. A future supported reader revision must have its own version identifier and tests.
- Success writes only verified normalized transaction cache evidence and the receipt. Existing candidate snapshots, their observed times, frozen research inputs, wallet profiles and eligibility remain unchanged. A later ordinary collection adopts the saved body through the existing cache recovery path and must obtain a fresh wallet snapshot. A cache recovery is not a verified funding relationship, common control, organic activity or an eligibility certificate.
- The cached wallet-plan API now includes the optional `reader_recovery` status and `source_recoverable_markers`, plus the `reader_recovery` planning stage. Discover shows reserved UTC allowance, bounded planned rechecks and ten recent retained receipts. API reads make zero provider requests. All 74 existing OpenAPI paths remain; historical evidence schemas and hashes are unchanged.

Implementation: `discovery/src/funding-recovery.ts`, `funding-recovery-model.ts`, wallet collector/continuation/planner integration, `app/src/discovery/WalletCoveragePlan.tsx`, the migration, generated OpenAPI and read-only wallet-plan checker. No new environment variables. The existing enabled, unpaused wallet collector admits work automatically; this adds no separate timer or remote service.

D1 cache/receipt atomicity follows [Cloudflare's batch transaction documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). The migration was applied only to the existing local persistence directory using the [documented local migration command](https://developers.cloudflare.com/d1/wrangler-commands/).

## Validation and actual progress

- **421 discovery tests in 36 files passed.** The new recovery suite covers read-only planning, current/older readers, supported v1 source decoding, exact second-hop instruction/legacy identities, unavailable and irreparable windows, poisoned/absent retained bodies, concurrent two-per-turn/twenty-per-day limits, immutable interrupted receipts, atomic rollback, changed evidence, quota exhaustion, shared rate-limit backoff and unchanged frozen snapshots/eligibility. The final accounting/checkpoint-time guard was followed by focused recovery, wallet continuation and cache recovery tests and discovery typecheck.
- App typecheck/build and performance budget passed; home startup remains **233.9 KiB gzip**. OpenAPI was regenerated from runtime schemas.
- Local read-only checks replayed four wallet snapshots, the current and two legacy backing records and three retained election rehearsals. Policy/caps were unchanged, backing outcomes remained withheld and checks made zero provider requests. Preview security smoke checks denied fifteen private-file requests and passed ten operator admission checks.
- The local collector restarted during validation; its existing supervisor restored it. Subsequent timer/watchdog checks were healthy with no issues. No new collector or manual provider refresh was started.
- At **2026-10-20 16:25:48 UTC**: **0/10 eligible**, one contender requiring a new snapshot and twelve source-limited plans. There were **zero cached-recoverable and zero source-recoverable markers** under the unchanged bounds; **0/20** recovery reservations had been used. Wallet usage was **659/800** at that observation. These are rolling observations, not a claim that all tokens have been scanned or that ten qualifying tokens exist.
- Browser review verified the local [Discover recovery panel](https://app-local.10x.meme/discover#wallet-coverage-plan), its empty receipts state and free-budget explanation. No wallet or operator credential was entered in the browser.

Commands from the repository root:

```powershell
pnpm --dir discovery test
pnpm --dir discovery test -- src/funding-recovery.test.ts src/wallet-work.test.ts src/funding-cache.test.ts
pnpm --dir discovery typecheck
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-discovery-wallet-plan.ts
pnpm exec tsx scripts/check-discovery-operations.ts
pnpm exec tsx scripts/check-backing-local.ts
node scripts/check-tenx-security-local.mjs
git diff --check
```

Local migration, from `discovery/`:

```powershell
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
```

Next: investigate finishable low-activity windows and free archive coverage with retained fixtures; measure any genuine recovered evidence before claiming improvement toward ten. The ten-token target, independent backing completeness/historical USD, live votes/rewards, [provider credential rotation](29-security-review.md) and protocol/financial release decisions remain open. No deploy.
