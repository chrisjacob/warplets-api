# Network production release

## November refresh

On 5 November the owner approved monthly refreshes for existing member records.
Profiles, verified-wallet associations and balance observations rotate every
30 days. Missing profiles, associations and wallets take priority and remain
eligible immediately, so daily new-member discovery stays current. Independent
asset prices still refresh hourly without re-reading token quantities.
Stored wallet estimates use the 30-day observation window for both balances
and last-valid accepted quotes. If an hourly quote is unavailable, the previous
dated estimate remains; its balance and quote dates stay visible. New quotes
still pass the existing timestamp/confidence checks before replacing it.
Activity checks cover completed UTC calendar months once after month-end;
provisional checks made before a month closed are revisited, while accepted
positive evidence is retained. The ongoing month remains a lower bound.
Indexed hints page past newer-month actions with bounded cursors before raw
protocol confirmation. Provider failures retry under existing cooldowns and
budgets; an unresolved month never becomes confirmed inactivity.

The `codex/network-release-2026-11-05` release repairs the post-reset queues.
November had already reached Network's own 250,000-credit Neynar ceiling;
this was not evidence that the account allowance was exhausted. The original
activity importer also omitted the required reaction filter and rejected valid
cast-removal messages, repeatedly pausing the whole queue.

Network now explicitly allocates up to 9M Neynar credits/month, preserving the
usage ledger and leaving 1M outside Network within the previously confirmed
10M free allowance. Production fetches tariffs from the same public JSON feed
used by Neynar's own pricing page, caches them daily and pauses Neynar reads if
an eligible tariff cannot be verified. This feed disagrees with the reference
documentation: bulk users cost two credits/FID, userdata 100/request,
verifications 50 and single cast/reaction messages 100. The live pricing feed
takes precedence. Inexpensive indexed cast/reaction/follow
hints are confirmed by the original protocol message before counting; target
cast hashes never masquerade as reaction-message hashes. No observation is
inferred from an empty result. Activity remains a positive-evidence lower bound,
including while every selected member-month has been checked.

An explicit official-client profile 404 marks current status unavailable and
excludes that FID from the current-member cohort. Acceptance events, historical
snapshots and cached profile fields/timestamps remain intact; no opt-out or zero
value is inferred. New missing profiles retry daily, and a later successful profile
restores observed quality and can establish current membership again.

The documented billing endpoint returned HTTP 401 with the existing API key.
Its official schema exposes subscription/plan details, not credit consumption
or a remaining balance. Observed `x-ratelimit-*` headers concern request rate;
they are not monthly credits. These caps therefore remain explicit app-side
allocations, never presented as live account-wide usage.

Production now refreshes 60 profiles, 25 wallets and 10 activity candidates per invocation,
with four readers, shared leases and existing global Alchemy pacing. Ingestion
renews its lease during long batches. Finalized contract logs use a validated
public Base RPC with configurable ranges up to 1,000 blocks; every range still
requires matching original mint events, timestamps, block hashes and the
existing reorg checks. Source attempts are capped at 1M/day and 3M/month, allowing
the first large refresh to use a daily burst without increasing the monthly
request ceiling. Paid-provider credit and CU ceilings are enforced separately.
Alchemy allocation is 6M CU/day and 20M/month, leaving 10M outside Network
within its published 30M free allowance; the ten-RPC/s gate is unchanged.
No provider plan or billing setting is changed.
The batch importer permits up to six readers for an isolated operator request,
while scheduled production keeps four. Both use the same ten-RPC/s gate and CU
ledger; six matches the per-invocation outgoing-connection ceiling.
Profile/chain collection, wallet refresh and activity now have independent cron
leases; a slow portfolio or credit pause cannot hold up new-member discovery.
Neynar requests reserve both a 400-RPM global gate and a 240-RPM per-endpoint
gate. These remain below even the legacy Starter limits of 500 global and 300
per endpoint (the current Free tier allows 1,000/600). Query/FID parameters and
trailing slashes share the same endpoint bucket. Rate limits remain distinct
from the monthly credit allocation.
Both provider gates now atomically reserve future request times in one database
call per turn. Sustained parallel readers cannot starve one another by winning
repeated polling races; the rate and credit limits are unchanged. The original
polling gate caused local rate pauses even without a provider rejection.
Activity additionally preserves the projected cost of monthly wallet-association
rotations for the rest of the UTC month, using the current cohort, live per-FID
tariff and 10% growth margin. Exhaustive activity retries therefore cannot spend
the allowance needed to keep wallet associations current. This forecast is an
app allocation; it does not claim to know the account's remaining credits.

Live directory QA also exposed a resource overload: the wallet-owner query used
`IN(full current cohort)` and rescanned the cohort for every page address.
The unknown-location first page read 2,862,690 rows and consumed 1,386ms of D1
SQL time. An indexed address/profile join, using the same shared membership
predicate, reduced that ownership check to 425 rows and 3.6ms against production.
A query-plan regression requires indexed FID lookup rather than a profile scan.
Snapshot publication had a second overload source: grouped cohort/ownership
CTEs consumed 2,066ms and read 1,066,270 rows across their first two queries.
Capturing the member cohort once and seeking wallet links by indexed FID,
then aggregating ownership in memory, reduced those production reads to 265ms
and 233,902 rows. The captured cohort keeps association and ownership counts
consistent; a regression verifies the indexed plan and snapshot totals.
The initial larger live batches failed before database cleanup could run.
Production batches leave room for the existing scheduled applications, and
sanitized runtime failures are logged. Lease cleanup retries transient D1
overloads for up to fifteen seconds, always matching the original owner. A
replacement owner's lease is preserved; non-transient invocation limits are
not retried within the same invocation.

`scripts/network/production.ts --remote --task=status` reports the live queues.
Explicit `profiles`, `scan`, `associations`, `wallets`, `activity`, `prices` and
`publish` tasks reuse the production importers and quota ledgers. Use `--wait`
to wait for a busy lease. Each invocation is bounded by `--steps=1..1000`.
The runner validates the existing account/database, uses the current Wrangler
grant, and never prints credentials. Large REST transaction parameters stage
under a unique private `network_sync` key and are removed after execution;
transaction rollback was verified with an isolated temporary marker.

Official references checked 5 November 2026:
- https://docs.neynar.com/reference/compute-units
- https://dev.neynar.com/api/pricing
- https://docs.neynar.com/reference/what-are-the-rate-limits-on-neynar-apis
- https://github.com/neynarxyz/OAS/blob/main/src/api/spec.yaml
- https://github.com/neynarxyz/OAS/blob/main/src/hub-api/spec.yaml
- https://www.alchemy.com/pricing

The shared `follow-redirects` override is patched to 1.16.2 for the newly
published GHSA-mrwp-f3q8-3g9p advisory. Existing browser-installer audit
exceptions remain unchanged.

Release branch: `codex/network-release-2026-10-29`. The release includes the latest local Network feature set and the shared legal updates. The old discovery product is excluded.

## Release sequence

1. **Prepare:** run root/app typechecks, tests, security and dependency checks, app build, performance/release checks, and handoff tests. Merge and deploy through the existing `deploy.yml` pipeline with Network serving/ingestion disabled.
2. **Bootstrap:** export the allowlisted local Network observations and geography with `scripts/network/handoff.py`. Verify checksums and restore/replay into a new SQLite file. Import using the same tool with explicit production account/database IDs and the existing Wrangler executable. The production database is never replaced. Imports are idempotent, budget counters use maxima, and successful chunks have D1 checkpoints. Preserve the complete original history privately; production starts with the latest valid snapshot per UTC day.
3. **Activate collection:** keep all equivalent local importers stopped. Deploy the root Worker with bounded Network ingestion enabled. Recompute current snapshots and Warplet indexes from production records. Verify a successful production run and a new snapshot before enabling public serving.
4. **Activate serving:** register `network.10x.meme` on the existing `10x-app` Pages project, enable serving, deploy Pages and verify desktop/mobile behavior, public APIs, shared legal pages and existing products. Keep the Mini App registration endpoint disabled on Network.

The owner explicitly confirmed on 29 October 2026 that Network should release with the existing observations and existing freshness information, without additional labels. Full-cohort refresh before activation is therefore not required. The October handoff records 591,527 of 600,000 source requests consumed and 249,888 of 250,000 Neynar credits reserved; importing does not reset these counters. Alchemy remains capped at 1.5M CU/day and 10M CU/month. Source request defaults remain 100,000/day and 600,000/month. No paid-plan change or quota increase is part of this release.

## Commands and artifacts

Run `python scripts/network/handoff.py --help` for commands. Export/import artifacts contain profile and wallet observations and remain in ignored private local storage. Do not upload the dataset to Git or public CI artifacts. `restore-verification.json` binds restoration proof to the manifest. `remote-progress.json` and `network_sync` checkpoints support resume. `remote-verification.json` records production counts and the manifest digest. `scripts/network/check-release.mjs` prevents enabling collection before bootstrap verification and serving before a successful production run.

The production schema retains migration history through `0103_network_warplet_images.sql`. Derived holdings and Warplet indexes, process leases, and local runtime state are rebuilt rather than copied. Only named safe synchronization keys transfer. Budget reservations are never lowered on replay.

The repository workspace lockfile is authoritative. The stale standalone `app/pnpm-lock.yaml` is retired; app installs and CI run inside the existing pnpm workspace and use the root lockfile. The shared dependency remediation pins patched Zod, with scoped CDP/Quick Auth overrides and an aligned CDP ABI schema version. Real SDK schema and authentication request regressions run in CI. Unused Pigment CSS is removed, eliminating its vulnerable DOM transformer dependency. Existing narrow browser-installer audit exceptions remain unchanged.

## Verified handoff and preparation record

Preparation PRs #81 and #82 are merged; the corrected existing deployment pipeline completed successfully. Production migrations through 0103 are applied. The private preservation archive restored all 15,645 files and SQLite snapshots; its SHA-256 is `db6a42579d7788b3094a22c2ef5d99ac909e2b56e63e55ac4cf6008805b0d15f`. Archive tag `archive/10x-discovery-2026-10-29` and the separate safety branch are also preserved on origin.

The Network handoff manifest SHA-256 is `c56d302cf3ee07ba27854c4893d27b7046b906996b3efc972f15aa6fd9b064c5`. Restoration, replay and production table counts are verified: 29,143 saved profiles, 29,167 acceptance events, 61,623 wallet observations, the required canonical geography, and 11 daily historical snapshots. Imported quotas preserve all prior usage. Root collection activation uses the unchanged explicit caps above; public serving remains independently gated. The owner explicitly authorized reuse of the existing Alchemy key on the existing root Worker; it remains server-side.

The importer handles UTF-8 CLI logs and Wrangler upload progress before JSON metrics, uses actual index counts as conservative write bounds, checkpoints every successful chunk, and refreshes only the existing OAuth grant if a long operation crosses access-token expiry. It never requests broader scopes. The shared legal revision and its archives were published by the preparation deployment; the publication date in Sydney is 29 October 2026, distinct from the documents' revision date.

Collection activation PR #83 and the edge-runtime correction in #84 are merged and deployed. The first successful production run recorded 20 refreshed profiles and five reconciled acceptance events at `2026-10-29T12:57:02.437Z`. Snapshot publication and production-derived holder indexes were verified before public serving was enabled. The fetch helper uses manual redirects and rejects all non-2xx responses; a real HTTP regression confirms that redirect targets are never followed.

Published privacy, terms and both historical documents return HTTP 200 and match the reviewed source after newline normalization. Both Social fragments and mobile/desktop layouts were verified. A separate unauthenticated Social HTML check does not establish analytics traffic or account configuration; no Social client source or analytics setting was changed.

## Recovery and observation

Disable `NETWORK_ENABLED` to hide Network and `NETWORK_INGEST_ENABLED` / `NETWORK_WALLETS_ENABLED` to stop its collection. Re-deploy the existing Pages/Worker projects; preserve unrelated settings and secrets. If necessary restore the previous application deployments. Do not reverse additive migrations, drop shared tables, replace the database, or restore a local database to production.

Verify the first scheduled collection, snapshot publication, quota handling and daily refresh. Preserve a private release record with deployment IDs, manifest/checksums, migration state, aggregate counts and smoke-test results. Coverage gaps remain visible through the existing UI. Provider failures retain the last accepted observations.
