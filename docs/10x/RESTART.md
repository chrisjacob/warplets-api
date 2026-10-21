# Restart and resume 10X.MEME development

Current research update, 21 October: [prospective v2 capture and model-separated outcomes](61-versioned-score-research.md), local migration 0038, now records current v2 grades and retains the archived v1 study unchanged. Research defaults to v2 and provides a separate v1 view with pinned replay links. Pending outcomes share five total finalizations and five distinct-token spare collection slots; daily 100-record / 10 MB admission and all provider/evidence gates remain. Mature outcomes and independent calibration remain open. No deploy.

Market-integrity update, 21 October: [XTO review and versioned score-v2 checks](60-market-integrity-score.md) adds dated ceilings for abrupt sampled price moves, thin reported depth relative to cap and dust-dominated post-creation trade samples. Material later buys replace raw buyer counts for participation credit; flagged momentum earns no points. Cards and details explain the evidence. V1 replay, its labelled prospective comparator, all action gates and free collection limits remain. Prospective v2 cohorts are now retained by the continuation above; independent calibration remains open. No deploy.

Handoff recorded 21 October 2026 (Australia/Sydney). This is a recovery snapshot; inspect current Git history, code, documentation and local data before acting on it.

After rebooting, reopen the repository in Codex and send:

> Read `docs/10x/RESTART.md`, restore the local preview, and continue our 10X.MEME work within its constraints. No deploy.

## Workspace and checkpoint

- Repository: `C:\Users\cjacob\Documents\GitHub\WarpletsAPI`
- Branch: `codex/10x-thesis-foundation`
- Remote: `https://github.com/chrisjacob/warplets-api.git`
- Latest endpoint collection: [bounded score follow-up after expiry](59-score-endpoint-followup.md). Ordinary market batches reserve at most five spare targets for pending score endpoints, matched to the frozen provider/baseline and exact retained pool. History-only writes never reactivate or refresh expired candidates. Cached coverage is on Research; preserve 15-minute attempt reservations, source backoff/quotas, owned leases and immutable score/election replay. Endpoint follow-up itself adds no migration; current model-separated research requires local 0038. No real next-day score outcome was due at the original validation.
- Latest score research: [prospective grade retention and 24h outcomes](58-score-outcome-research.md), local migration 0037. Existing maintenance captures bounded first mint/model scorecards with zero provider calls and finalizes comparable outcomes after 26h. Research shows descriptive counts, not predictive validation. Inspect current captures/automation before quoting counts; do not backfill old cohorts or alter score-v1 to fit later outcomes.
- Last application checkpoint: `fb9f207` — `feat(10x): simplify token evidence and contribution journeys`, committed and pushed.
- Previous checkpoint: `d71fefc` — streamlined discovery navigation and evidence flow.
- Latest local engineering milestone: [preview recovery and launcher shutdown](50-preview-recovery.md). Consult recent Git history for its commit. The isolated App preview uses Vite 5183 / Pages 8788; Discovery retains its existing supervisor and store on 8794.
- Latest coverage milestone: [cache-only funding continuation](51-cache-only-funding.md), with zero-RPC guarded checkpoint adoption and unchanged eligibility/source limits. Consult current Git history and cached status; the last recorded eligibility remains 0/10.
- Latest discovery intake: [bounded exact-mint requests](53-exact-mint-intake.md), including local migration 0033, Admin/CLI enqueue and cached progress on Data status. Kimchi was queued without forcing source work; inspect current progress before claiming admission or eligibility.
- Latest rehearsal recovery: [complete snapshot chunk storage](54-election-snapshot-storage.md), local migration 0034. The normal tick recovered `daily-2026-10-21` with 442 complete inputs, four chunks and no eligible winner. Old records/rules remain unchanged; the 500-candidate bound and declared byte bounds still fail visibly. Status now includes intake's existing quota subset.

This handoff will have a later documentation commit. Start with `git status --short --branch` and recent history; do not reset, force-checkout or overwrite work to match this snapshot.

Unrelated network work was dirty at handoff: files under `app/functions/_lib/network/`, `app/functions/api/network/dashboard.ts`, `scripts/network/` and `docs/network/SNAPSHOTS.md`, including new snapshot implementation/tests. Preserve that work and exclude it from 10X commits unless explicitly assigned.

## Restore project context

Read applicable `AGENTS.md` instructions, then:

1. [Milestone index and implementation history](README.md).
2. [Current PRD v1.2](spec/10X_MEME_FULL_PRD_v1_2.md), including founder-authorized graded discovery in §4.7. V1.1 remains retained as history.
3. [Original AI agent engineering brief](spec/AI_AGENT_BRIEF.md).
4. [PRD task map, progress and remaining work](19-prd-task-map.md).
5. [Unresolved decisions and authority boundaries](04-decisions.md).
6. [Latest customer journeys and progressive evidence milestone](49-customer-journeys.md).
7. [Previous discovery and navigation milestone](48-discovery-experience.md).
8. [Local discovery operations](../../discovery/README.md).
9. [Security review and outstanding credential follow-up](29-security-review.md), and [performance review](28-performance-review.md), as relevant.
10. [Preview restoration and launcher shutdown](50-preview-recovery.md), including current runtime ports, the interruption fix and remaining source gaps.
11. [Cache-only funding continuation](51-cache-only-funding.md), including saved-progress semantics and the remaining live source limitations.

Read the full PRD before planning implementation. Reconcile older prose with later milestone records, actual code and tests. Document requirements do not independently authorize deployment, spending, publication or unresolved economics. The user's explicit constraints below take precedence over staging/deployment wording in the brief.

## Standing user instructions

- **Local development only. No deployment.** Reuse the existing local preview tunnel; do not create remote resources or enable production schedules.
- Use free services first, stay within current API allowances and honor shared budgets, backoff and pause state. Do not buy plans or enable billable overages.
- Keep every current eligibility and evidence gate. Report missing, stale and sampled evidence honestly. Never fabricate evidence or weaken a gate to reach a token count.
- Commit and push completed, validated milestones to the existing branch. Stage only task-related files; preserve unrelated work.
- Keep secrets private. Do not print `.dev.vars`, credentials or sensitive process arguments, or include secrets in commits.
- No real financial execution, token launches, treasury actions, reward payments or social publication. Simulations must remain clearly labelled. Do not infer unresolved economic or signing authority.
- Keep the end-user journey simple: browse tokens, inspect charts and important risks, then inspect supporting evidence if needed. Detailed collection mechanics belong in evidence panels or operator tools.
- Preserve explicit message review and verification before Solana sign-in. A wallet connection alone establishes neither sign-in nor a vote.

## Implemented foundation and known gaps

The local implementation includes separately verified Pump creation and PumpSwap graduation evidence, strict 24-hour creation eligibility, holder/concentration analysis, developer and early-buyer wallet analysis, direct and second-hop pre-buy funding evidence, token artwork, price/market-cap observations and sampled verified trading fees. Coverage is cached, resumable and budget bounded; incomplete evidence continues to block eligibility.

Other milestones include automatic local collection and recovery, daily outcome/cohort research, signed Solana identity, backing/launch/reward rehearsals, content contribution/moderation/appeal workflows and private replayable authorship/near-duplicate evidence. These do not establish production financial execution, certified organic trading, complete wallet history or verified social engagement. Consult the task map for precise scope and remaining PRD requirements.

The latest UI/UX milestone is complete:

- Discover, Content and My wallets are primary; research, information and simulation tools are secondary.
- Discover shows token filters/cards before collection diagnostics, which live in Data status.
- Token pages put artwork, key values, eligibility and important warnings before charts and expandable evidence. Evidence deep links still open the relevant panels.
- Content has an appropriate empty state and campaign-gated contribution steps.
- Explicit Solana sign-in supports a validated return to the original task.
- Labs share a short simulation notice; readability and control sizes were improved.

The homepage is intentionally empty. The original landing experience remains at `/thesis`, accessible as **The 10X Thesis**.

**Ten eligible tokens created within the past 24 hours remains an unmet action-readiness diagnostic.** Graded browsing is the current primary product target. The last recorded coverage checkpoint was **0/10**; read fresh local state before quoting a current count. Wallet/funding completeness, source coverage and freshness remain important constraints. Improve coverage without relaxing gates or exhausting free allowances.

Dedicated small-screen-device, assistive-technology and real-wallet signing QA remain open. Mocked signing tests are not a live-wallet exercise. Provider credential rotation remains an outstanding security follow-up; do not expose credentials while investigating it.

The latest application milestone passed 54 UI tests across seven files, app typecheck and build. Home startup was 234.1 KiB gzip across eleven chunks, below the unchanged 250 KiB budget. Browser checks covered discovery, token evidence/deep links, Content, task-return links, Data status and simulation notices. These are historical results, not a claim that checks have run since reboot.

## Restore local services after reboot

Work from the repository root in PowerShell. Read the relevant Cloudflare/Wrangler skill instructions before running Wrangler-backed commands. Inspect startup scripts and port availability first; do not kill unrelated Node or Cloudflare processes.

Preserve and reuse these ignored local stores:

- `C:\Users\cjacob\Documents\GitHub\WarpletsAPI\discovery\.wrangler\local`
- `C:\Users\cjacob\Documents\GitHub\WarpletsAPI\app\.wrangler\10x-preview`

Do not reset the databases, replace the stores, seed fake current data or overwrite existing private configuration. Dependencies should already be installed; do not reinstall automatically merely because the machine restarted.

### Discovery collector

The current-user scheduled task `10X-Discovery-Local` should start its hidden supervisor at login and check every five minutes. The workstation must be awake and the user logged in. Check task state and service health before starting another collector:

```powershell
Get-ScheduledTaskInfo -TaskName 10X-Discovery-Local
```

The existing launcher is `scripts/dev-discovery.mjs`; the manual fallback, only if the service is not already running and after checking supervisor ownership, is:

```powershell
pnpm --dir discovery local
```

The discovery Worker uses loopback port 8794. After it is healthy, inspect status without forcing collection:

```powershell
node scripts/discovery-operator.mjs status
```

The operator CLI reads its token privately from the existing configuration. Respect any intentional pause state. Avoid repeated manual refreshes or bypassing rate limits. Investigate supervisor recovery before reinstalling its task or starting duplicate launchers.

### App and existing preview tunnel

Inspect `scripts/dev-tunnel-app.mjs` and the local operations guide first. The previous workstation preview settings were:

```powershell
$env:APP_LOCAL_VITE_PORT = '5183'
$env:APP_LOCAL_PERSIST_TO = '.wrangler/10x-preview'
pnpm --dir app local:tunnel
```

This launcher applies pending **local** app migrations to the selected store and starts the app API, Vite and the existing `app-local` tunnel. Check the selected persistence path and pending migrations before running it; do not switch to remote migration or deploy commands. Confirm actual ports from the launcher and health checks rather than assuming old runtime ports are still in use.

Preview: **https://app-local.10x.meme**. Reuse this tunnel; do not create or deploy a new one. Check Discover, a token detail page and `/thesis` once both services are healthy.

## Continue implementation

Latest founder instruction: [PRD v1.2 §4.7](spec/10X_MEME_FULL_PRD_v1_2.md) replaces binary eligibility as the primary discovery order with a 0–100 grade. [Graded discovery](57-graded-discovery.md) implements score-first cards, separate effective evidence coverage, dated risk ceilings, component details and exact JSON export/offline replay. Scores use cached data only and a fixed denominator; unknown fields are never assumed safe. Preserve discovery-score-v1 replay when introducing later versions. Do not restore eligibility-first display or call zero proof of a scam/100 guaranteed trust. Existing action gates, action ranks and frozen election engines remain independent. Ten fully eligible tokens is now a readiness diagnostic; useful graded browsing is the primary product target.

Earlier token-review request: review Pump.fun **Kimchi** `CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump` and its “vamps”, then continue the PRD. [Initial review](52-kimchi-review.md), [bounded exact-mint intake](53-exact-mint-intake.md), [daily rehearsal storage recovery](54-election-snapshot-storage.md), [verified creation expiry](55-candidate-expiry.md) and [per-pool market validation/replay](56-market-batch-validation.md) are recorded. The target remains scanning with one saved signature page, seven intake reservations and no certified migration/candidate at the last check; inspect fresh progress before claiming admission or eligibility.

Local migration 0036 adds owned market publication and two bounded replayable diagnostic cache slots. Normal responses replayed 30/30 validated quotes, then 29/30 with one missing canonical pool held unchanged. Data status explains partial coverage; raw replay is operator-only. Pause, lease expiry/replacement, quotas, exact identity and freshness gates remain. Never force a refresh merely to fill the diagnostic slots. The old `market_schema_invalid` payload was not retained, so do not claim its exact root cause was identified.

Local migration 0035 and ordinary maintenance completed 194 initial expiry receipts without deleting candidate/evidence rows; one subsequent entrant made 443 retained / 249 active at the last checkpoint. The frozen daily v1 record still retains all 442 original inputs and replays unchanged. Unknown dates remain active. Current coverage is still 0/10; holder/wallet source gaps remain. Prioritize complete current source evidence, exact Kimchi intake and supported recorded adversarial paths. Non-WSOL certification, original/copycat attribution, deeper funding, unknown-date growth, long-term compaction and the ten-token goal remain open. Preserve existing source limits, evidence gates and schedules.

Briefly report the recovered checkpoint, preview/collector health, current coverage gaps and the highest-priority remaining task. Then continue the next justified PRD milestone within these constraints, incorporating any newer user instruction. Do not redo completed milestones or assume that every PRD feature is implemented.

Keep graded discovery and evidence coverage visible while improving source completeness; the ten-recent-eligible count remains an action-readiness diagnostic. Validate meaningful changes with appropriate tests, typechecks/build checks and browser QA; use isolated fixtures rather than fake production-looking records in the main local store. Update progress documents with completed work, evidence, unresolved assumptions and next tasks. Commit and push the relevant changes. **No deploy.**
