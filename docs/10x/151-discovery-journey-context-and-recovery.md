# 151 — Discovery journey context and recovery

22 October 2026. Continues the approved F2 daily-decision work after [150](150-rendered-artwork-and-saved-token-reliability.md), within [148's build order](148-free-serving-assessment-and-build-order.md). The [149 serving decision](149-native-builder-and-combined-free-budget.md) stays held.

## Delivered

Opening a token from a card, compact table, comparison or saved list now carries a bounded Discovery return context. Back to Discovery preserves search, action-check filter, age window, sort, layout, freshness/liquidity/coverage filters and up to three selected mints. Comparison and saved-list links return to their own sections. The saved disclosure opens on an initial or subsequent `#saved-tokens` navigation, including off-page saved-token reopen.

The token page offers its return link while loading and after a failed detail read. Direct links without a return context use known defaults in the inspected live/simulation mode. Navigating never switches a simulation inspection into live Discovery accidentally. Comparison observations still require an explicit request and a verified common-cutoff report after returning; this change does not persist or revive old comparisons.

The return hint accepts only the local `/discover` path and two known sections, then rebuilds the known query through the existing view validator. It rejects external/protocol-relative/backslash/control/oversized targets, discards unknown parameters and API cursors, clamps invalid filters and verifies comparison mint selection. The inspected mode overrides any mode inside the hint. The shared query parser moved to a pure module without changing candidate-query semantics or creating UI import cycles. No credentials, observations, grades or pagination cursors are added to local storage.

**Boundary:** this restores the view and selected mint identities, not the prior page cursor, exact scroll offset or old observation cutoff. Return reads the current first page under existing rules. Frozen later-page paging semantics and explicit comparison freshness remain unchanged. The global Discover navigation remains a deliberate fresh entry point.

## Recorded browser journeys

`pnpm test:discovery-journey-browser .tmp/NEW-JOURNEY-STUDY` launches the actual Discovery page, router, controls, token detail, comparison and shortlist in its own headless Chrome profile. Synthetic responses use the unchanged paging/detail schemas, real synthetic v4 records and the unchanged comparison verifier. Optional panels fail closed. Outbound network requests are blocked; no application bindings, credentials, live database or provider requests are used. The synthetic query responder tests navigation state, not backend filter correctness or token selection quality.

Five scripted find → inspect → compare → save → reopen journeys pass:

| Journey | Initial view | Checks shared by all five |
|---|---|---|
| 1 | Cards, default search | Inspect, keyboard return, compare two exact mints, inspect comparison, save, exclude saved mint from search, reopen from saved, return to open saved section |
| 2 | Table, QA search, liquidity sort, all ages | Same journey with the table links |
| 3 | Cards, name search, stale filter, coverage 30 | Same journey with non-default freshness/coverage |
| 4 | Table, QA search, excluded action checks, liquidity 25,000 | Same journey with non-default action/liquidity filters |
| 5 | Cards, name search, all ages, coverage 45 | Same journey with another filter combination |

Every journey preserves the initial view and selected mints, then checks off-page saved identity, unknown organic metrics and read-only requests. Two additional cases verify failed-detail recovery and unsafe direct-return fallback in simulation mode. Desktop 1280×900, mobile 390×844 and narrow 320×900 layouts have document widths 1265, 375 and 305 px respectively; the three screenshots were visually reviewed. This is scripted synthetic evidence, not independent human usability/accessibility, actual text zoom, live artwork coverage or enabled-route Web Vitals acceptance.

Final private report: `.tmp/discovery-journeys-20261022-151-009/report.json`, SHA-256 `80ace3b41c93be883bd0e63359fd672e72a6c58d199c29b0a23a552e4aa7a451`. It includes browser-bundle, runner and fixture hashes, per-journey read counts and explicit keyboard-return results. Earlier attempts 001–006 found harness fixture/serialization issues; they did not relax any application gate. 007 completed before final exact-order/keyboard checks; 008 passed those checks before explicit runner/fixture pins were added. These directories are preserved and ignored; 009 is the final reproduction.

The existing artwork study also passes all ten scenarios after the saved-disclosure change: `.tmp/artwork-browser-20261022-151-001/report.json`, SHA-256 `c248aeed09ef61144eacce9f48b39fdf98162640a688bde199ccba5e18bb4828`. Earlier 150 evidence remains intact.

## Validation and next work

All **158 Discovery UI tests across 32 files pass**, including four new return-context, unsafe-input, mode-isolation and rendered-link regressions. App typecheck, local production build, performance budget, thesis-only release check, security preflight/blocklist and original research row/foreign-key preservation pass. The closed home-shell budget remains 227.8 KiB gzip across eleven chunks; this is not an enabled-Discovery performance claim. Original private proof/target/journal pins and actual credential exclusion are checked separately. Unrelated Network/legal edits remain outside this commit.

F2 remains partial. Next measure rendered artwork on a **dated admitted live cohort** with visible/attempted/decoded/missing/failure denominators, then independent usability, keyboard/screen-reader/contrast, actual 200% text zoom/device and enabled-route performance acceptance. The five automated journeys satisfy the scripted regression slice only. Use existing saved observations first; any live acquisition must retain current source, quota, evidence and time admission. Broad unfamiliar-token yield, preregistered qualified participation and read-only release acceptance follow 148's order. Source-bound v4 input-preparation cost remains a named release blocker under 149; no runtime adoption or freshness widening.

No Worker/API schema, source adapter, v4 grading/evidence/action/election/financial gate, provider limit, research authorization, retained evidence, spent allowance, production exposure flag, migration or dependency changed. Everything remains free. No collection, spending, quota reset, evidence deletion, runtime switch, live migration, restart or deploy. Thesis-only exposure remains closed to unfinished functionality.
