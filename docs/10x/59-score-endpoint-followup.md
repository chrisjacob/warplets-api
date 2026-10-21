# Bounded market follow-up for prospective score outcomes

Plan, 21 October 2026. PRD v1.2 §§4.7/15.1 and the prospective score milestone require later comparable endpoints. Review found that ordinary market rotation reads only active candidates, so verified creation expiry can stop observations before the 24h-after-capture target. New score cohorts were also absent from the legacy tracked-cohort union. Retention/replay alone does not solve collection completeness.

1. Plan cached follow-up work from pending score cohorts, including retained expired candidates, only inside capture+23.5h through capture+26h. Require a fresh usable frozen baseline, matching configured provider and exact retained mint/pool identity. Withhold unknown baselines, source mismatches and invalid identities rather than substituting data.
2. Reuse the existing paced market batch and allowance. Keep the ten current-contender slots and up-to-ten migration-screening slots; use at most five remaining slots for due score follow-ups, with the rest rotating normally. No extra batch, timer, RPC, source quota or remote resource. Follow-up planning is bounded and read-only.
3. Collect at most one usable pre-target sample and one usable at/after-target sample through this path; once a comparable post-target sample is cached, stop. Missing/invalid responses may retry at most once per token per 15 minutes, still subject to global source backoff, pause, owned lease and budget. Prioritize post-target work and earlier closing windows; sample availability is not guaranteed.
4. Append validated follow-up quotes only to market history and ordinary attempt/diagnostic state. Never refresh an expired candidate payload, create a new observation/recommendation cohort, remove expiry receipts or restore action eligibility because research requested a quote. Frozen score/outcome versions and hashes remain unchanged. Finalization remains after the full 26h window, including explicit insufficient data.
5. Expose cached follow-up readiness/holds on Research, including source status and the next window, without triggering source work. Test expiry-to-endpoint-to-outcome integration, exact identity/provider checks, timing/cooldown/deduplication, focus/lead/30-target bounds, quota/backoff/lease/pause behavior, zero endpoints, publication rollback and old replay. Validate, document, commit/push locally. No deploy.

This changes collection allocation within existing free budgets; it does not promise every cohort an endpoint or certify a predictive model. Legacy research cohorts, source completeness, mature calibration and long-term archival remain separate work.

## Implemented behavior

The planner reads the latest 500 pending score cohorts with compact projections, plus an overflow marker. Indexed history lookups check for usable pre-target/post-target observations without loading full archives. It verifies cohort-summary checksums and exact saved/current mint/pool identity, then classifies each pending record once: missing baseline, provider mismatch, missing identity, awaiting window, awaiting target, closed window, saved endpoint, cooldown or ready. The configured source must match the frozen baseline; zero baseline denominators are not measurable. Future/unknown, duplicate-instant or differently sourced endpoints do not satisfy collection. Zero-valued endpoint prices/liquidity are valid observations. Equivalent timestamp spellings cannot prematurely stop collection when outcome replay would exclude them; ordinary source writes use canonical millisecond UTC timestamps.

Market collection reserves up to five remaining slots for ready score targets after the existing contender/migration groups, excluding duplicate mints. Post-target windows and earlier closing windows go first, then oldest attempt and address. Each selected full scorecard is replayed before source admission. Invalid research evidence is withheld with `score_followup_evidence_invalid`; current-token collection can still proceed. This path does not widen the 30-target batch, raise allowances or add a timer. A market cycle with only due research may use one ordinary allowed batch; calls stay within existing pacing and shared quotas rather than promising the request count is always identical to an empty cycle.

Before the source call, a guarded request reservation records the selected research addresses in the existing attempt ledger after reserving the ordinary market quota. Consequently HTTP errors also respect the 15-minute per-token cooldown. Spent reservations survive a provider error, discarded response or publication rollback; they are not successful quotes. The original owned lease, pause, source backoff and daily-budget guards remain. Valid follow-up history and diagnostics publish in the existing [atomic D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), while candidate payloads, proof/expiry receipts and frozen cohorts are untouched. No new D1 migration, environment setting or provider adapter was needed.

`GET /api/10x/research/scores/followup` returns cached readiness, hold counts, next opportunity, configured source/error and batch/cooldown bounds. Its read makes zero provider calls and writes nothing. Research exposes it in **Outcome collection coverage**, separately from measured outcomes. A ready target is not a guaranteed endpoint, and source or workstation unavailability can still leave outcomes insufficient. No missed endpoint is invented or retrospectively forced.

## Validation and remaining work

Twenty-one new backend cases include both configured DEX and default Gecko paths from immutable expiry receipt through history collection and full outcome replay. They check byte-identical candidate/cohort retention, exclusion after expiry, one shared request reservation, five follow-up/ten contender/ten lead/30-target bounds, timing, malformed/source/future/duplicate endpoints, reported zero endpoints, baseline/identity holds, cooldown after HTTP failure, pause/expired/replacement leases, quota exhaustion, invalid-evidence isolation, publication rollback and the 500-record projection bound. Synthetic SQL fixtures certify these application behaviors, not real chain identities or a live next-day outcome. Three UI cases cover holds/backoff, bounded capacity, stale reads and unavailable state.

The first cached local receipt at **2026-10-21T01:52:55Z** reported **36 pending**: **30 missing usable baselines**, **six awaiting their window**, zero ready/closed/saved endpoints. Earliest collection opportunity: **2026-10-22T01:04:34.501Z** (12:04:34 PM Sydney). The source reported `market_batch_partial`; existing backoff was preserved. Browser QA later showed 42 pending records, six awaiting windows and 36 baseline holds, with the same next opportunity. No real score endpoint was due during these checks, and no actual matured live outcome is claimed.

At **01:56:55Z**, the cached plan showed **48 pending / 42 baseline holds / six awaiting windows**, zero ready or saved endpoints, with no market-source error at that checkpoint. The earliest window was unchanged. Cached operations had a recent timer and fresh independent watchdog, no restart recommendation and no election error, while a separate `wallets_source_issue` remained visible. Three historical election records replayed, including the unchanged 442-input daily record; the original scorecard checksum `457bce8c…` also replayed exactly. Verification made zero provider calls and never forced a source refresh.

The App typecheck/build and startup-budget check passed, with **234.1 KiB gzip across 11 home-shell chunks**, below the unchanged 250 KiB budget. Discovery UI checks passed **74 tests across 14 files**. The generated OpenAPI contains **94 paths**. No changes were made to the score, outcome or election evaluators.

Final backend validation passed **849 tests across 52 files** and typechecking, including the duplicate-timestamp collection correction. `git diff --check` passed. The service-test fixture now applies its already-required migration 0037 so the normal market handler is tested with the complete current schema; no runtime migration or evidence gate was added or relaxed by this milestone.

The original score/outcome/election evaluators and all financial restrictions remain. Additional certified source paths, legacy research follow-up scope, unknown baselines, mature holdout/calibration, provider permissions, remote free-tier capacity and long-term archive/restore remain open. Keep the workstation awake for the existing local collection timer; no deployment occurred.

Commands:

```powershell
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app test src/discovery
pnpm --dir app build
node node_modules/tsx/dist/cli.mjs scripts/generate-discovery-openapi.ts
node node_modules/tsx/dist/cli.mjs scripts/check-score-followup.ts
node node_modules/tsx/dist/cli.mjs scripts/check-score-research.ts
node node_modules/tsx/dist/cli.mjs scripts/check-discovery-operations.ts
node node_modules/tsx/dist/cli.mjs scripts/verify-discovery-scorecard.ts .tmp/discovery-scorecard-457bce8c.json
git diff --check
```
