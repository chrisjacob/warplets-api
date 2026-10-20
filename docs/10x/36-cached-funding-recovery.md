# Cached funding recovery and recorded v1 wallet evidence

21 October 2026 (Australia/Sydney). Advances PRD §§4, 5, 11.8 and 14.2 and P3/P6 in the [task map](19-prd-task-map.md). Product documents guide implementation; the founder's local-only, free-first, no-deploy and unchanged-evidence-gates instructions control execution.

## Coverage improvement

Previously, a funding checkpoint's `missing` or `unsupported` marker was restored without checking whether another normally metered collection had since cached that exact transaction. The planner therefore classified the window as source-limited even when reusable evidence was already present.

The planner can now recover those references in a read-only projection using saved wallet transactions. It verifies the normalized payload hash, primary signature, exact signature-row slot and block time, successful transaction structure, referenced wallet and fetch-time bounds. It does not infer a funding relationship from cache availability. Existing anchor/trade/creation replay still determines whether a funding window and resulting analysis are valid.

The existing full wallet collector and direct-funding continuation can consume the validated cache body and promote the exact mutable checkpoint marker. Persistence checks the previously verified checkpoint hash; a concurrent advance cannot be overwritten by that repair. The consumed body must match the body verified during planning. If record/byte bounds prevent consumption, the old marker remains. Exact second-hop instruction keys and matching legacy aliases are supported without transferring progress to a different outflow instruction.

Planning performs **zero provider requests and zero writes**. Cache recovery performs no replacement RPC fetch. A normal continuation still performs its existing cluster check, and a fresh full snapshot still needs its existing paced source reads. No RPC quota, catch-up allowance, retry policy, scan window, evidence bound or freshness threshold increases.

Bounds remain eight direct windows/four second-hop windows, three pages and twelve examined bodies per window, a 64-record wallet sample, 250 KB per body and 900 KB of materialized transaction data. Cache recovery inspects at most the eight-by-twelve references and materializes at most 64 distinct bodies within the byte bound. Absent references in earlier windows cannot permanently hide a cached reference in a later window. Missing boundaries, nonfinalized/unknown-time signatures, oversized windows and unavailable cache bodies remain blocking.

Old wallet evidence, candidate timestamps/eligibility, research cohorts, election inputs and frozen backing results are not rewritten by a continuation. No source observation is fabricated or freshened. Historical decoder replay does not enable the new recovery option. A repaired checkpoint is not a fresh eligibility pass: the normal collector must create a new full wallet snapshot, and every existing gate must pass.

The Discover funding-plan section now reports `cached_recoverable_markers`. The response field is optional without a default for compatibility; current local plans emit an explicit count. A positive count means reusable evidence exists, not that a token is eligible. No new endpoint, dependency, secret, migration, provider or collector is introduced.

## Real v1 wallet fixtures

Two public normalized bodies collected through the existing metered finalized-RPC reader are now retained as offline fixtures:

- [`v1-wallet-trade.json`](../../discovery/fixtures/recorded/v1-wallet-trade.json): one supported Pump buy, payload hash `793b9b120be1a714c9203a21221204359cb35678c8d2abd57cc2d076af673c0a`, fetched at `2026-10-20T15:39:44.372Z`. Replay verifies the exact trade, signer, quote/base amounts and resource-config normalization.
- [`v1-wallet-funding.json`](../../discovery/fixtures/recorded/v1-wallet-funding.json): one directly signed pre-buy System transfer, payload hash `5bb10dc2da7a75e0b698b3a37e260a108cccc7448a029541e3d96d420f46abea`, fetched at `2026-10-20T15:21:37.772Z`, plus its retained buy anchor. **The transfer is one lamport.** It demonstrates observed transfer/timing decoding, not meaningful financing, common ownership, organic activity or fraud. No amount-based policy change is introduced.

These are normalized RPC evidence, not raw wire transactions, independent consensus/finality certificates, general v1 coverage or token-eligibility certification. Existing synthetic adversarial tests and pinned historical hashes remain. Fixture extraction read the local cache only, made zero provider requests and wrote no synthetic data to the running application database.

## Validation and actual result

- **380 discovery tests across 35 files passed.** After the final lookup-starvation bound adjustment, **all 44 focused funding-cache, wallet-work and v1 tests passed**. New tests cover missing/unsupported recovery, wrong hash/signature/slot/time/wallet, future fetches, absent cache, irreparable windows, bounded lookups, exact body consumption, concurrent checkpoint changes, second-hop instruction isolation/legacy keys and unchanged old candidate/evidence replay.
- Discovery/app typechecks, app build and performance budget passed. Home shell startup remains **233.9 KiB gzip**.
- The running read-only wallet-plan check replayed four historical wallet snapshots; backing checks replayed the current and two legacy records; three election rehearsals replayed. All used zero provider requests. Timer/watchdog were healthy. Preview security checks denied fifteen private-file requests and passed ten operator admission checks. Browser review confirmed the recovery explanation without a user wallet or operator credential.
- At the working-data check: **0/10 eligible**, two contenders needing a new wallet sample and eleven source-limited plans. No current marker had a reusable cached replacement. Wallet usage was **641/800** for the UTC day at that observation; collection continued normally. This milestone establishes the recovery path and recorded supported v1 wallet examples; it does not claim additional eligible tokens.

Commands from the repository root:

```powershell
pnpm --dir discovery test
pnpm --dir discovery test -- src/funding-cache.test.ts src/wallet-work.test.ts src/transaction-v1.test.ts
pnpm --dir discovery typecheck
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-discovery-wallet-plan.ts
pnpm exec tsx scripts/check-backing-local.ts
pnpm exec tsx scripts/check-discovery-operations.ts
node scripts/check-tenx-security-local.mjs
git diff --check
```

Next: better coverage of genuinely finishable low-activity funding windows, bounded source-version recovery where no cached body exists, and fresh holder/market/wallet evidence together. Larger scan limits, more providers or policy changes are not implied. The ten-token target, independent backing completeness/historical USD, live votes/rewards and [provider credential rotation](29-security-review.md) remain open. No deploy.
