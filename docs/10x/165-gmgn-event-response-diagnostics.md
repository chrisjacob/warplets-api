# GMGN event response compatibility diagnostics

23 October 2026, Australia/Sydney. Continues [164](164-shortlist-wallet-event-follow-up.md). No deploy.

## Delivered

- [x] Add a versioned, bounded structural diagnostic for rejected GMGN event pages. Distinguish missing/null/object/array/scalar fields and exact array counts at the expected `activities`, documented nested `data.activities` and `list` positions. Cursor diagnostics record type only. No alternate position is accepted automatically.
- [x] Retain at most12 whitelisted validation paths/codes and the explicit existing missing/conflicting-event-type check. These distinguish a valid array with invalid rows from a missing array or oversized page. Paths are at most100 characters; unknown codes become `other`. No provider/Zod message text, arbitrary keys, row values, wallet/signature/token identifiers, cursor contents or scalar amounts enter the diagnostic.
- [x] Capture diagnostics only after the original byte/complexity/envelope/key-echo checks and an event-schema failure. HTTP/authentication errors, credential echoes and accepted event pages do not gain this diagnostic. Failed bodies remain null; no rejected raw data is retained or reconstructed.
- [x] Include the optional diagnostic in newly retained failure receipts, bound by their original receipt hash. Replay it through the saved-review, token summary and attention queue readers. Preserve original164 and earlier receipts exactly; their missing diagnostic stays missing.
- [x] Add a collapsed response-structure explanation on attention failures and token evidence. Missing/null rows remain distinct from an explicit empty array; structural counts confer no event, organic-volume or scoring credit. Earlier accepted samples keep their own dates.
- [x] Personal review capture/export/restore retains diagnostics when present. Optional fields have no defaults, so older issue/context hashes remain stable. Later UI changes cannot mutate captured diagnostic context.

## Acceptance and limits

The original event schema and acceptance criteria remain unchanged: at most20 events, exact mint, valid signatures, supported and consistent event types, valid quantities/times, no exact duplicates, and explicit missing/unusable/signed USD treatment. Original accepted observation/report hashes and the existing source/selection replay rules remain intact. No activity is accepted because its structure resembles a documented response.

The [official portfolio reference](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-portfolio/SKILL.md) documents an `activities` page with `next`, and mentions an additional `data` wrapper on some deployments. The [official client](https://github.com/GMGNAI/gmgn-skills/blob/main/src/client/OpenApiClient.ts) still uses the token-filtered wallet-activity route. These references justify inspecting the specific nested position, not assuming which format caused the old failure or accepting an undocumented alias.

No new provider request type, endpoint, pagination, retry, timer, hourly slot, allowance, migration or dependency/config change. The existing hourly collector and shared Free controls remain in charge. Current-hour duplicate admission returned `activity_hour_already_reserved` with zero provider calls. A future ordinary reservation is required to learn the actual response structure; the spent164 hour is not reopened. Diagnostic work adds no visitor-triggered provider IO or source reads to the48-receipt/8MB queue envelope. Thesis-only exposure, serving149 and all evidence/action/election/financial/score gates remain held.

## Verification

Tests cover absent/null/empty/nested/list/oversized structures, malformed event-type refinements, bounded paths/codes, exclusion of arbitrary keys/messages/values/cursors and credential echoes, legacy hash stability, full receipt replay and cached API/UI propagation. Browser checks first use the untouched164 cache with clearly synthetic diagnostic/event variations; the final003 run uses the new frozen live50-row failure and its explicit20-event-bound explanation. Desktop1280, mobile390 and reflow320 have zero provider calls, document overflow, unexpected requests or browser exceptions. Screenshots were visually inspected. Synthetic accepted examples remain labelled as such; this is component evidence, not live event acceptance or independent full-app accessibility/performance approval.

The final full backend run passed1,510 tests/103 suites;29 affected cases pass after naming the unchanged20-event constant. Discovery UI:186 tests/39 suites pass. Both typechecks,14 relay/operator checks, the closed production build, performance budget, thesis-only guard and security preflight pass. Home startup remains227.8KiB gzip/11 chunks. Final results and live artifacts are retained privately. Older private artifacts/proof rows remain preserved. No migration, manual runtime restart or deploy.

## Live result and concrete next change

At2026-10-22T16:01:52.976Z, the next ordinary hour admitted `aaefe25f-a051-4ef8-82e7-890595b7c9a7`, costing one metered HTTP request. Earlier admission holds made zero provider calls and did not reset backoff. HTTP200 returned an object with `activities` containing50 rows and a string `next`. The diagnostic records `activities: too_big`. There is no extra `data` wrapper in this response.

Our descriptor and fixed relay forward `limit=20` unchanged, matching the documented parameter. The20-event maximum is our existing internal request/normalization contract, not a Free-plan request allowance. This provider response exceeds that contract. The entire page remains failed with a null retained body; its50 rows were not discarded down to20 or granted event/organic-volume credit. Old164 evidence remains unchanged. The current cached issue now states the50-versus20 mismatch explicitly. No later check establishes whether all50 rows satisfy mint/time/duplicate rules, because the over-bound page never passed the original normalizer.

The next build should implement a **separately versioned complete50-event research-page contract**, with all rows validated, original20-event replay preserved, explicit requested/returned counts and no score/action adoption. Assess existing event/RPC comparison and serving bounds independently; do not broaden them implicitly. This replaces speculative wrapper work and another diagnostic layer as the immediate priority. It does not approve truncation, reinterpret failed receipts, change provider Free quotas, or reopen this spent hour. Until the versioned contract exists and passes live validation, accepted event coverage remains outstanding.

## Decision required from the next ordinary sample

1. The observed50-row response above now determines the immediate versioned-page work. Only a separately observed documented nested page would justify a wrapper adapter; do not reinterpret old failed receipts or bypass mint/event checks.
2. A missing/null event page remains unavailable, not measured zero. An oversized page must stay held; do not silently slice rows or increase evidence bounds to force acceptance.
3. A valid array with rejected rows requires the specific documented field semantics before a parser revision. Unknown event types and foreign mints remain held.
4. Once live events are accepted, use the existing bounded independent transaction comparison where coverage permits, then qualified holder observations and prospective shortlist usefulness. Avoid adding another source/score layer while this compatibility issue remains unresolved.
