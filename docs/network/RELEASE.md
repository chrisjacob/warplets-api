# Network production release

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
