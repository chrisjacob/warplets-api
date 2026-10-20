# PRD implementation checkpoint and next tasks

Reviewed 20 October 2026 against the entire [PRD v1.1](spec/10X_MEME_FULL_PRD_v1_1.md), the [agent brief](spec/AI_AGENT_BRIEF.md), source code, migrations, tests and local operations. This supersedes the kickoff backlog's status, not the PRD or historical review records. Document instructions inform the plan; the founder's explicit local-only, free-first, no-deploy and unchanged-evidence-gates instructions control execution. The homepage remains empty and `/thesis` retains the original homepage.

## What exists and what is incomplete

| PRD area | Implemented evidence | Remaining gap |
|---|---|---|
| §§4,17.1 Solana discovery | Separate finalized Pump creation and PumpSwap migration proofs; canonical identity/pool; strict age/permission/reserve gates; capped shortlist and cached APIs | Bounded WSOL/Pump-only coverage, provider gaps and stale snapshots; ten eligible recent tokens have not been achieved |
| §§4,14.2 ownership/activity | Reconciled holder inventory, dev/buyer roles, direct and second-hop pre-buy funding, sampled verified trading fees, price history and artwork | Beneficial control, actual bundle attribution, LP locks, complete funding archives and organic activity remain unverified |
| §§11,15,17.6 local operation | Shared quotas, durable cursors/jobs, backoff, hidden local timer/supervisor, independent local watchdog, immutable daily rehearsals and 14-day offline discovery fault exercise | Local workstation must stay awake; external alert channels and full voting/settlement fault exercise incomplete; no remote cron |
| §§11.8,15.1 improvement loop | Frozen observation/recommendation/wallet cohorts, daily outcome revisions, chronological holdout proposals and wallet associations; separate prospective cap/linearity cohorts | Not enough mature outcomes for validated new rules; diagnostic outcomes are collecting and cannot activate policies |
| §§11.3,13.1,15.1 policy review | This milestone: `/transparency` Rules page and authenticated Admin policy lab, retained inputs/results/hashes, replay/download and audit | No production policy approval or activation endpoint; previews compare current snapshots, not investment performance |
| §§5,17.2 community backing | [Signed Solana ownership](23-solana-identity.md), [cached-trade ledger](24-backing-ledger.md), [cutoff snapshots/provider references](25-cutoff-history-and-price-references.md) and [bounded wallet-window collection/RPC finality observations](26-wallet-window-coverage.md), with frozen membership and replay | Independently complete election indexing/finality, verified historical USD, stronger membership revisions, unified identity and approved D07 scoring remain incomplete; all backing outcomes withheld, no live votes |
| §§6,8,10 launch/treasury | Architecture, state machines and decision register | Exact three-pool simulator/devnet receipts, same-chain $10X, issuance/custody/fee decisions and controlled signer all outstanding |
| §§7,9,17.4 attention/rewards | Requirements and budget design only | Content submission/moderation, raw ranks, boost snapshots, ten independent campaign ledgers and claims not implemented |
| §§4.1,6.5 other chains | Chain-aware architecture; Solana capability flags | Base, BNB and Robinhood adapters remain uncertified; no implied chain or launch support |

## Ordered work packages

P6 update: [retained cutoff snapshots/provider references](25-cutoff-history-and-price-references.md) now have [bounded frozen-wallet history collection and RPC finality observations](26-wallet-window-coverage.md), with offline source manifests and explicit missing evidence. Verified historical USD, independently complete source/finality coverage and stronger membership evidence remain outstanding.

Effort estimates are engineering ranges, not delivery promises. They exclude outcome maturation, provider decisions, audits and founder decisions. Tasks use local data/offline fixtures first and create no paid resources or onchain transactions.

| ID / priority | Next deliverable | Acceptance and meaningful checks | Dependencies / effort |
|---|---|---|---|
| P1 / now | Policy transparency and audited stricter comparisons | Publish actual thresholds/hash and review-only warnings; freeze the same candidate inventory/time for both policies; replay after market changes; reject relaxed/disabled evidence gates, tampering, unauthorized requests and duplicate-ID misuse; enforce atomic daily cap | Implemented in this checkpoint; local migration 0014 |
| P2 / implemented locally | Freeze new anomaly features for outcome research | Capture market-cap/creation-age and sampled linearity at their first usable diagnostic observation time with source hashes, sample coverage and version; unknown stays unknown; no retroactive enrichment of old selection inputs; no future-price leakage | [Local implementation and validation](20-signal-research.md); prospective outcomes are collecting |
| P3 / high, advanced locally | Improve funding coverage yield within current allowances | [Verified checkpoint planning, limit-aware collection and measured yield](21-funding-yield-review.md) implemented; all gates remain. Next: certify additional supported transaction paths and recoverable source boundaries with recorded adversarial fixtures; report failure to reach ten honestly | Five-call local continuation completed three additional windows; ten eligible tokens still unmet. Further work depends on free-source coverage |
| P4 / local discovery implemented | Local reliability exercise and independent health check | [14-day offline discovery exercise and local watchdog](22-local-reliability-review.md): duplicate ticks, 48h outage, quotas, stale/future evidence, database reopen, abandoned-job recovery and no-eligible days passed; full PRD voting/settlement coverage remains outstanding | Independent same-workstation checker running; external alert recipients require founder setup. No production uptime or financial workflow certification |
| P5 / local foundation implemented | Signed Solana wallet linking foundation | [Domain/browser/action-bound challenges, strict signatures, atomic replay/ownership/session rotation, signed self-unlink, conflict/rate limits and local Wallet Standard UI](23-solana-identity.md). Connecting gives no votes | Unified identity, lost-key recovery, hardware/mobile and real extension certification remain incomplete |
| P6 / bounded window collection implemented; independent verification next | Eligible-buy ledger and backing rehearsal | [Automatic ledger/replay](24-backing-ledger.md), [cutoff snapshots/provider prices](25-cutoff-history-and-price-references.md), and [budget-bound signed-wallet history/finality observations](26-wallet-window-coverage.md). Incomplete windows hold projections; all outcomes withheld | Need independently complete supported-window indexing/finality and rollback handling, certified historical USD, stronger membership/Sybil evidence and approved D07 before live credit |
| P7 / protocol research | Exact three-pool simulation and devnet work package | Pin protocol/SDK revision; integer 50/20/20/10 allocations; ATTN-only OG/$10X inception; exact rounding, ranges, reverse swaps, mismatch/arb, lock and fee claims; report executable depth and failure recovery | D08–D10 parameters and protocol feasibility; 4–8 days after choices. No generic AMM substitute or funded signer assumed |
| P8 / gated | Supervised launches, attention campaigns, boosts, trader rewards and additional chains | Full PRD acceptance/security/budget tests per module; one active spotlight, ten-day 10% maximum, raw ranks before boosts, independent chain-$10X reserve and no founder mint | P4–P7, applicable D08–D18 decisions and explicit release/financial authorization; estimate after validation |

The existing collection timer continues alongside these work packages. Reaching ten eligible tokens stays an open acceptance target, not a reason to loosen evidence or spend beyond the free caps. Paid DEX profiles/boosts remain non-preferential. Cap and smooth-rise warnings remain unvalidated diagnostics.

## Decisions and release boundary

Local development is not blocked by choosing production token supplies, beneficiaries or reward weights. Those remain in the [decision register](04-decisions.md). Market-data usage/redistribution permissions, certified additional launchpads, published eligibility policy, signer custody and same-chain $10X are still release dependencies. Full ATTN launch must include its planned $10X pair; the rollout must bootstrap viable local $10X before that launch.

Do not enable mainnet transactions, social posting, paid plans, policy activation, treasury moves or remote deployment as a consequence of this task map. The existing feature branch may be committed/pushed under the founder's standing instruction.

## Policy milestone implementation notes

`/api/10x/transparency/policies` returns the current `discovery-local-v3` document, SHA-256, production-approval status and separate diagnostic descriptions. `/transparency` renders that document, required evidence and freshness limits.

`POST /api/10x/admin/policies/preview` now accepts a strict `{request_id, reason, edits}` body. Only the nine numeric threshold fields displayed in the policy lab are editable, and only in the stricter direction. Creation/graduation requirements, 24h age, proof checks, holder/wallet requirements, freshness windows, policy version and 100-candidate cap cannot be edited. This replaces the old unaudited arbitrary-policy preview contract; it changes no active policy.

The operator gets baseline/proposed counts, per-token added/removed reasons, threshold differences, frozen observation time and replay hashes. UUID retries return the same retained record; conflicting reuse fails. Authenticated GET of `/api/10x/admin/policies/previews/:id` verifies saved hashes and reproduces both results. Downloaded evidence includes the complete inputs. No operator token is saved in browser storage or included in evidence. Records use a separate table, leaving election/research snapshots unchanged.

New previews have a 20-per-UTC-day atomic admission cap, 500-candidate bound and explicit byte limits; oversized inventories fail instead of truncating. The snapshot and its audit entry commit in a D1 batch. [Cloudflare documents D1 batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Local migration syntax follows the [Wrangler command documentation](https://developers.cloudflare.com/workers/wrangler/commands/); migration was applied with `--local` and the existing `.wrangler/local` directory. There are zero provider requests per preview. This does not certify future remote D1 storage/CPU allowances; local retention and remote budgets need review before deployment.

Input is capped at 1.6 MB, combined comparison results at 0.8 MB, and input plus result at 1.9 MB with metadata headroom, below the [documented 2 MB D1 row limit](https://developers.cloudflare.com/d1/platform/limits/). The first local check exposed the difference between storing one election result and two comparison results; the combined bound fixes that without removing candidates.

## Validation record

The full discovery suite passed 197 tests; the policy tests passed again after the size-bound correction. App build/performance checks and discovery/app typechecks passed. The generated OpenAPI includes strict preview request/response schemas and protected replay retrieval. Local migration 0014 applied successfully. No new environment variables, paid services or signing capabilities were introduced.

The end-to-end local check compared all 370 stored live candidates at its frozen observation time: eligible 0 → 0, provisional 14 → 12, excluded 356 → 358 under a hypothetical $50K liquidity floor, with three changed reason sets. Repeat and protected GET returned the same verified record; the active policy hash was unchanged and unauthenticated access returned 401. This is not progress toward ten eligible tokens and does not activate the higher floor.

Commands used for this checkpoint (all local):

```powershell
pnpm --dir discovery typecheck
pnpm --dir discovery test
pnpm --dir discovery test -- src/policies.test.ts
pnpm --dir app typecheck
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
# From discovery/:
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
pnpm exec wrangler d1 execute TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local --command "SELECT COUNT(*) AS candidates,SUM(length(CAST(payload AS BLOB))) AS total_bytes,MAX(length(CAST(payload AS BLOB))) AS largest_candidate FROM tenx_candidates WHERE mode='live'" --json
# From repository root:
pnpm exec tsx scripts/check-discovery-policies.ts
git diff --check
```

The policy smoke check uses one new daily preview slot, retries it, verifies saved replay and writes the local ignored `.tmp/policy-preview-local.json` review artifact. Its provider request count is zero.
