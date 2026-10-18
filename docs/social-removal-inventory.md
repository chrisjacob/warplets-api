# Social removal inventory

Checkpoint: `.tmp/social-removal-recovery/` (ignored; contains source archive, hashes, patch and local database backups).

Preserve Stonklets commits `2daf1b1`, `48e7b3e`, `296b813`, uncommitted news ownership fixes, Network including migrations 0095?0097, and all unrelated code/data. No Git history reset or remote changes.

## Shared files: split

- `app/functions/_lib/appSlug.ts`
- `app/functions/_lib/authValidation.ts`
- `app/functions/_lib/security.ts`
- `app/functions/api/auth/wallet/challenge.ts`
- `app/functions/webhook.ts`
- `app/functions/webhook/[appSlug].ts`
- `app/shared/favicons.ts`
- `app/src/main.tsx`
- `app/src/miniAppChrome.tsx`
- `app/functions/index.ts`
- `app/vite.config.ts`
- `src/production-scheduler.ts`
- `app/package.json`
- `scripts/prepare-stonklets-release.mjs`

## Social-only files: remove

- `app/functions/_lib/social.test.ts`
- `app/functions/_lib/socialAirdrop.ts`
- `app/functions/_lib/socialApi.ts`
- `app/functions/_lib/socialAudience.ts`
- `app/functions/_lib/socialAutomation.test.ts`
- `app/functions/_lib/socialAutomation.ts`
- `app/functions/_lib/socialBoostApi.ts`
- `app/functions/_lib/socialBoostJobs.ts`
- `app/functions/_lib/socialBoostOwnership.ts`
- `app/functions/_lib/socialBoostSubscriptions.ts`
- `app/functions/_lib/socialBoosts.test.ts`
- `app/functions/_lib/socialBoosts.ts`
- `app/functions/_lib/socialChart.test.ts`
- `app/functions/_lib/socialChart.ts`
- `app/functions/_lib/socialClaims.ts`
- `app/functions/_lib/socialContent.ts`
- `app/functions/_lib/socialDiscovery.ts`
- `app/functions/_lib/socialEconomy.test.ts`
- `app/functions/_lib/socialEconomyAdmin.ts`
- `app/functions/_lib/socialEconomyApi.ts`
- `app/functions/_lib/socialEconomyStore.ts`
- `app/functions/_lib/socialEmbed.ts`
- `app/functions/_lib/socialFomo.ts`
- `app/functions/_lib/socialIngestion.ts`
- `app/functions/_lib/socialLaunchPreview.test.ts`
- `app/functions/_lib/socialLaunchPreview.ts`
- `app/functions/_lib/socialLeaderboards.ts`
- `app/functions/_lib/socialMarket.ts`
- `app/functions/_lib/socialProductHunt.ts`
- `app/functions/_lib/socialProvider.ts`
- `app/functions/_lib/socialReview.test.ts`
- `app/functions/_lib/socialScoring.ts`
- `app/functions/_lib/socialScoringJobs.ts`
- `app/functions/_lib/socialStore.ts`
- `app/functions/_lib/socialTestDb.ts`
- `app/functions/_lib/socialToken.ts`
- `app/functions/api/admin/social.ts`
- `app/functions/api/social/[[path]].ts`
- `app/public/embed_social.png`
- `app/public/favicon-social.ico`
- `app/public/icon_social.png`
- `app/public/manifest-social.webmanifest`
- `app/public/splash_social.png`
- `app/shared/social.ts`
- `app/shared/socialBoosts.ts`
- `app/shared/socialChart.ts`
- `app/shared/socialContent.ts`
- `app/shared/socialEconomy.ts`
- `app/shared/socialEmbeds.test.ts`
- `app/shared/socialEmbeds.ts`
- `app/shared/socialLinkPreviews.test.ts`
- `app/shared/socialMetadata.ts`
- `app/shared/socialPicks.ts`
- `app/shared/socialText.test.ts`
- `app/shared/socialText.ts`
- `app/shared/socialTokens.test.ts`
- `app/shared/socialTokens.ts`
- `app/src/SocialAdmin.tsx`
- `app/src/SocialAllocationAdmin.tsx`
- `app/src/SocialApp.css`
- `app/src/SocialApp.tsx`
- `app/src/SocialAutomationDetails.tsx`
- `app/src/SocialBoostAdmin.tsx`
- `app/src/SocialBoosts.tsx`
- `app/src/SocialCalloutChart.tsx`
- `app/src/SocialEconomy.tsx`
- `app/src/SocialEconomyAdmin.tsx`
- `app/src/SocialLaunchImage.tsx`
- `app/src/SocialMedia.tsx`
- `app/src/SocialOnboarding.tsx`
- `app/src/SocialPostDetails.tsx`
- `app/src/SocialText.test.ts`
- `app/src/SocialText.tsx`
- `app/src/SocialTokenCard.test.ts`
- `app/src/SocialTokenCard.tsx`
- `app/src/SocialUI.tsx`
- `app/src/socialClient.test.ts`
- `app/src/socialClient.ts`
- `app/src/socialReading.test.ts`
- `app/src/socialReading.ts`
- `contracts/SocialCheckIn.sol`
- `contracts/artifacts/SocialCheckIn.json`
- `docs/social-daily-picks.md`
- `docs/social-economy.md`
- `docs/social-implementation.md`
- `migrations/0076_social.sql`
- `migrations/0080_social_daily_picks.sql`
- `migrations/0081_social_economy.sql`
- `migrations/0082_social_identity_attribution.sql`
- `migrations/0083_social_cohort_integrity.sql`
- `migrations/0084_social_review_hardening.sql`
- `migrations/0085_social_score_allocations.sql`
- `migrations/0086_social_read_efficiency.sql`
- `migrations/0087_social_reward_reads.sql`
- `migrations/0088_social_boosts.sql`
- `migrations/0089_social_boost_metadata.sql`
- `migrations/0090_social_resumable_scores.sql`
- `migrations/0091_social_monthly_merit.sql`
- `migrations/0092_social_metadata_versions.sql`
- `migrations/0093_social_allocation_adjustments.sql`
- `migrations/0094_social_reward_summary.sql`
- `scripts/dev-tunnel-social.mjs`
- `scripts/social-automation-local.ts`
- `scripts/social-browser-test.mjs`
- `scripts/social-content-watch.mjs`
- `scripts/social-contract.mjs`
- `scripts/social-economy-local.ts`
- `scripts/social-economy-ui-test.mjs`
- `scripts/social-ingest-local.ts`
- `scripts/social-picks-ui-test.mjs`
- `scripts/social-preview.mjs`
- `scripts/social-producthunt-probe.ts`
- `scripts/social-review-browser.mjs`
- `scripts/social-seed-local.mjs`
- `scripts/social-seed-transactions.mjs`
- `scripts/social-tools/package.json`
- `scripts/social-ui-test.mjs`

## Preserve

Every other checkpoint file is preserved unless explicitly documented in the final report. The full per-file manifest and original SHA-256 hashes are in the recovery directory. The neutral test adapter is extracted before removing Social. Shared MiniAppPageHero, charting, domain parsing, social-profile APIs and email social-proof data are retained.

## Additional shared-file changes

- Four Network tests: only change the test adapter import to `sqliteTestDb`; preserve all test behavior.
- Workspace lockfile: remove unused `hls.js`, retain charting and domain parsing dependencies.
- Stonklets headline browser test: use `scripts/browser-tools` and `.tmp/browser-tools` in place of Social-named tooling. The same package and installed tools are retained.

## Baseline

Root: 18/18 tests passed. App: 876 passed, 3 failed (favicon uniqueness, AI perk asset availability, old seven-day spotlight expectation). Post-removal: 740 passed, 2 failed; the latter two are unchanged baseline failures. Favicon uniqueness now passes.

## Completed verification ? 2026-10-18

- Social supervisors/import watcher stopped; process recheck found none running. No remote resources were changed.
- Removed 117 Social-only source files, including migration 0076 and Social migrations 0080?0094. Shared files were edited selectively; no Git reset or history rewrite.
- Live local database: removed 213 Social schema objects, including virtual search internals and six triggers on shared tables. Preserved all 137 non-Social tables by exact row fingerprints; integrity and foreign-key checks passed (zero violations). Shared-table write probes passed and were rolled back.
- Cleanup passed on a database copy and on the active database; rerunning reports already clean. Fresh replay of all remaining migrations passed without creating Social schema.
- Local KV: 31 Social entries and 31 owned blobs archived and removed; 669 other entries preserved exactly. No Social-owned objects were identified in the configured local R2 bucket. Shared accounts and unrelated social-proof/profile data remain.
- Final source hash comparison: no unexpected changes to preserved files. Stonklets news ownership changes and Network source/configuration remain intact; only Network test-helper import paths changed.
- App suite: 740 passed, two existing failures. Worker suite: 18 passed. Isolated Network suite: 34 passed. Root, app and isolated Network type checks passed.
- Production build, asset-size budget, security preflight and whitespace check (allowing existing CRLF files) passed.
- Browser: shared menus checked at 320/390/1280px; Social absent, no JavaScript errors. Former Social GET and POST routes return 404. Network browser suite passed restricted routes, filters, pagination, FID search, responsive layout and no browser exceptions.
- Compiled localhost preview: http://127.0.0.1:8802/stonklets. Preserved Network preview restarted without a tunnel: http://127.0.0.1:8799/.

### Existing failures and cleanup limits

The two remaining app failures were present before this work: `src/perksAi.test.ts` expects an existing local logo, and `functions/_lib/stonkletSpotlight.test.ts` retains a seven-day-trial expectation despite the preserved immediate-activation behavior. They were not changed as part of Social removal.

Two legacy root Social tunnel log files remain because another process holds their file handles. Copies are archived; these are logs, not running Social services. Social-only scratch artifacts have moved under the ignored recovery directory. Browser tooling used by Stonklets was retained under neutral names.

Personal browser profiles were not modified: the connected-browser runtime could not start. Old client-only keys (`social-onboarding-v1` and `social-cast-confirmation`) may remain in a previously used browser. They are inert because the app is removed. To clear them without affecting shared authentication, remove only those keys from localStorage/sessionStorage on the exact origin where Social was used; do not clear the entire origin or browser profile.

### Recovery

Recovery material is local and ignored at `.tmp/social-removal-recovery/`: `source.zip`, original hashes, tracked patch, revision, per-file inventory, archived generated artifacts, database backups, KV backups and verification reports. Do not commit these backups; they may contain private local data. No expiry or automatic deletion is configured.

To recover code, extract only the required files from `source.zip` after comparing any subsequent edits. Before restoring data, stop local processes that write the target store and take a fresh backup. The live database recovery file is `database-d10ddcbd5bea9768.sqlite`; its report records the original target path. Restore through SQLite's backup API into a closed/controlled target rather than copying over a live WAL database. KV metadata and selected blobs are in `kv/`; restore them together while the local KV consumer is stopped. Restore archived Social scripts only if deliberately reviving the retired app.

The release packaging script now packages the selected committed revision without historical replacements. Current HEAD still contains the old Social commit until these working-tree changes are committed, so packaging that old revision intentionally fails its retirement check. No commit, push or deployment was performed.

## Release follow-up

The deployment request authorizes committing, pushing and deploying the cleaned application. Both pre-existing test failures have now been corrected: the perk-logo test resolves assets relative to its module, and the spotlight test validates the preserved immediate-activation behavior plus unauthorized rejection. The full app suite now passes: 122 files, 742 tests. The frozen workspace lockfile validates offline. Network production flags remain false. The local cleanup utility and recovery data are not part of deployment execution.
