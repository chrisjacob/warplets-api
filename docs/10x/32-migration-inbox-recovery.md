# Bounded recovery of earlier transaction-version gaps

21 October 2026 (Australia/Sydney). Advances PRD §§4.2, 4.6, 11.2 and 15, plus P3 in the [implementation task map](19-prd-task-map.md). All existing evidence gates, free-source caps and local-only operation remain required. No deployment, external scheduler, paid service, signing or financial authority was introduced.

## Observed problem and scope

The [v1 reader milestone](31-transaction-v1-coverage.md) fixed new reads but deliberately left earlier terminal gaps untouched. Read-only inspection found **70 migration inbox entries** marked `unsupported_transaction_version`, compared with no unsupported direct-funding bodies and one unsupported second-hop body. At the first recovery-status check, **68 inbox entries were queued within the previous 24 hours** and two were older. These unversioned historical rejections do not prove which transaction version the source contains; they are candidates for one current-reader recheck.

The local discovery timer now admits up to **two rechecks per refresh**, inside the existing **six inbox bodies** and **24 RPC calls per turn**. At most **twenty recovery admissions per UTC day** share the existing global RPC allowance. The lane does not use or increase the separate wallet allowance, does not force source pacing, and respects pause, provider backoff, quota reservation and the discovery lease. Fresh inbox work retains at least four of the six slots when recovery is available.

Only processed `unsupported_transaction_version` entries with queue and prior processing timestamps at or before the current observation, and a queue time within 24 hours, qualify. Invalid-layout, unsupported-quote and unrelated-transaction results are not mass-reset. Queue age is a work bound; verified creation time still independently determines token age. Older inbox gaps remain visible and untouched.

## Durable admission and evidence

Additive local migration `0025_inbox_recovery.sql` creates `tenx_inbox_reads`. Each `(signature, reader_version)` has one receipt. The current identifier is `solana-json-legacy-v0-v1-r1`; future changes require a reviewed new reader identifier, not an operator-controlled retry value. New unsupported reads also receive the identifier, preventing an immediate second purchase through recovery.

Admission atomically checks the exact old signature, slot and processing timestamp, active unpaused owner, per-job limit and global daily subset before reserving a receipt. Repeated/concurrent admission cannot reserve the same read twice. Reservations consume the subset even if a crash or a separate quota prevents the source call. Future-dated reservations conservatively consume the cap instead of creating extra room after a clock rollback.

The old inbox rejection and timestamp are retained in the receipt. Completion records the new outcome, time and normalized body hash where a body was decoded. Completion and the mutable inbox projection commit in a D1 batch, following the documented [transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Finished receipt identity/outcomes cannot be overwritten or deleted through ordinary SQL. A lost lease cannot finish a receipt; interrupted reservations remain visibly unconfirmed and do not automatically repeat with the same reader. These are local audit records, not externally signed proofs against a compromised database owner.

The network read still validates finalized commitment, signature and strict supported format/config. Recovery additionally binds the decoded slot to the original inbox row and rejects unknown/future block times. A readable body goes through the existing canonical Pump migration decoder and WSOL quote restriction. Verified migrations enter the ordinary lead store; creation search, graduation proofs, account state, holder inventory, wallet/funding checks, market thresholds, freshness and 24-hour token age must all still pass. No recovered body can directly mark a token eligible.

Missing archives, unsupported versions/layouts, rate limits, identity/time mismatches and crashes remain explicit gaps. Rate limits retain shared backoff. A recovery is a **single format-upgrade attempt**, not a new archival polling loop: even failed attempts are not automatically repeated with this reader. This deliberately saves free allowance but can leave a valid transaction unresolved after a transient failure. Retry policy for such failures requires separate bounded admission work. Ordinary newly queued archival misses keep their prior retry behavior.

Recovered migration bodies remain in the existing lead/evidence stores. Receipts retain hashes, not a second copy of every unrelated or unreadable body. Therefore not every receipt is independently replayable from saved body bytes. Funding/second-hop checkpoint markers, frozen wallet snapshots, election inputs, research cohorts and backing records are not reset or enriched by this lane.

## Review surface and validation

The public **[Data status recovery panel](https://app-local.10x.meme/status#inbox-recovery)** reports pending recent signatures, older exclusions, daily admitted/remaining counts and the latest ten receipts. It distinguishes an unconfirmed reservation from a completed source result and explains that readability does not establish eligibility. `GET /api/10x/discovery/inbox-recovery` reads local state only, sets `no-store`, makes zero provider calls and accepts no public writes. Generated OpenAPI includes its runtime-validated schema.

Offline tests exercise current-reader exclusions, age/reason boundaries, duplicate and concurrent per-turn/day admission, lease loss, interrupted reservations, atomic projection/receipt rollback, immutable finished records, new unsupported-read tagging, v1 canonical migration/creation proofs, and missing/unsupported/mismatched/rate-limited sources. The synthetic successful migration remains ineligible under the unchanged policy. No synthetic data is written to the live local database.

The local migration applied successfully without resetting data. The full discovery suite passed **339 tests across 34 files**, including the six-body scheduling regression; after retaining the first live fixture, all **20 focused recovery/v1 tests** passed as well. App build and typecheck passed; home startup remains **233.9 KiB gzip**. The focused panel/navigation checks passed four tests. Local checks replayed four wallet snapshots, three backing records and three retained election rehearsals with zero provider calls, and private preview/operator security checks passed. At the wallet check, eligibility remained **0 of the target 10**.

The first normally paced recovery ran at **2026-10-20 14:53 UTC** without a forced refresh. Two admissions produced one `unsupported_quote` result and one **verified v1 Pump migration** for mint `CxvwjisXKc2BuwPjzq6B67UFCqygRbjpbfTaGGyNpump`, signature `5ZDTk2ojPuwLbPgurPgHnwUkWf83uut3MkdmMwaPv7h6V3SejNdSAGhvaNsgJ5nsEhD7X7S6fFxsNGSZP4JyE3DY`, slot **459227949**. The normalized body is retained in [the recorded fixture](../../discovery/fixtures/recorded/v1-pump-migration.json) with hash `060cb546a36d7e1c834df5a9c5b5dec635ccbad321dd7ec8a2d30575bf0ccc57`. Offline replay reproduced that hash, canonical mint/pool/WSOL identity and graduation proof. This fixture certifies this supported migration path; it is not raw wire evidence, enriched wallet balances, a creation/holder proof or token eligibility.

The cached receipt check independently replayed the retained migration body with zero additional provider calls. The status panel showed **2/20 admissions**, **66 recent rejections remaining**, and **two older excluded entries**. A later operations check remained healthy, with a recent timer/watchdog and three retained election replays. Wallet v1 trade/funding fixtures and broader source completeness remain outstanding.

Commands, from the repository root unless noted:

```powershell
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app test -- src/discovery/InboxRecoveryPanel.test.tsx src/discovery/navigation.test.ts
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-discovery-inbox-recovery.ts
pnpm exec tsx scripts/check-discovery-wallet-plan.ts
pnpm exec tsx scripts/check-discovery-operations.ts
node scripts/check-tenx-security-local.mjs
git diff --check
# From discovery/; local storage only:
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
```

The recovery check is read-only, verifies the public subset and per-job bounds, and replays any retained verified migration bodies against their receipt hashes. It does not force a source refresh. Next work remains live v1 wallet/funding certification, bounded recovery of old funding markers and transient failures, and better coverage of source-limited current contenders. Ten eligible recent tokens, complete indexing/finality, verified historical USD and the remaining content/reward proofs are still open.
