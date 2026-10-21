# Prospective v2 observations and model-separated research

Local PRD §4.7/§15.1 continuation, 21 October 2026. No deploy, paid service or financial capability.

## Plan

1. Extend score-cohort-v1's versioned score payload to accept either frozen score model. Dispatch scorecard replay by its pinned version; preserve the byte identity and outcome algorithm of existing v1 artifacts.
2. Apply local migration 0038 to admit both mint/model keys and model-specific attempt records. Copy retained rows without recomputing payloads, hashes or timestamps; verify old rows and foreign keys before/after. Preserve the original store and save a local backup first.
3. New first-grade captures use the current v2 model. Stop new v1 captures; continue finalizing the existing v1 study. Both share the unchanged total limits: three capture attempts, five finalizations per maintenance minute; 100 records / 10 MB per UTC day. No old grade is reconstructed or replaced.
4. Add explicit model selection to cached summaries/detail links. Keep legacy HTTP reads without a model pinned to v1. The Research UI defaults to current v2 and offers v1 separately; never pool score bands or imply two differently timed captures are matched observations.
5. Follow up both versions within the existing five spare market slots, deduplicating mints and retaining shared per-mint attempt cooldown, exact frozen pool/provider identity, owned leases, pause/backoff and free allowances. One observed quote can support both windows only when independently comparable to each frozen baseline.
6. Validate migration preservation/rollback, same-mint model separation, daily aggregate bounds, outcome replay/tamper guards, historical v1 replay and deduplicated collection. Verify the existing preview and update PRD/task map, then commit/push. No deploy.

## Verification

Local migration 0038 was applied after an ignored full SQLite backup and isolated migration/rollback tests. A before/after comparison verified all 71 retained v1 cohort rows (including exact payloads, hashes and timestamps) and 71 v1 attempt records; no outcomes existed yet. Foreign-key checks reported no violations. An isolated populated migration test also preserved a completed outcome and its parent reference. No live evidence was seeded or recomputed.

The ordinary local maintenance tick captured the first three v2 cohorts at 02:26:50 UTC, with zero provider requests and no remaining research error. The first retained v2 export replayed with cohort hash `f7b365ec7c2a523b9352745aaf8c0ba9da074f4670687b43a4281e9b76afde63`. A pre-change v1 export still replayed with its original `4b42a706e83abd4359e57fb668362d349efec46d42063f5ad1d97449bf5dad82` cohort hash. By 02:30:50 UTC, Research showed 12 v2 captures alongside the separately selected 71 archived v1 captures; all were pending, with zero measured outcomes. Counts continue to change through the normal timer.

Backend validation passed 880 tests across 54 files, including model separation, cross-model corruption, migration preservation/rollback, current capture times, shared daily admission, five total finalizations, duplicate follow-up mints, shared cooldown and v2 provider/reference verification. Backend typecheck and all 76 discovery UI tests across 14 files passed. App typecheck/build and the unchanged home startup budget passed (234.1 KiB gzip across eleven chunks). OpenAPI was regenerated from runtime schemas with both model query parameters. Browser QA verified default v2, switching to archived v1 and back, distinct counts and the pinned v2 replay URL. The existing collector/watchdog was fresh; three retained election rehearsals replayed and the pre-existing wallet-source coverage issue remained visible.

D1 migration and deferred foreign-key behavior follow the current [Cloudflare migration documentation](https://developers.cloudflare.com/d1/reference/migrations/) and [foreign-key documentation](https://developers.cloudflare.com/d1/sql-api/foreign-keys/).

## Limits and remaining work

This records observations prospectively; it does not calibrate either model. Independent adversarial/benign labels, adequate mature time-separated outcomes, missingness/selection-bias review, source authenticity and true executable depth remain open. Captures after a model update occur at their real current time, not the earlier v1 capture time. Existing daily storage admission may defer new v2 observations until the next UTC day. Missing baselines/outcomes remain explicit.
