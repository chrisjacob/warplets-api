# Compact daily Discovery workspace

22 October 2026 (Australia/Sydney). Implements the first-result/wide-table design slice in [97 — product quality review](97-prd-design-performance-security-review.md) and PRD §17.7, following [98 — current/history separation](98-current-inventory-and-retained-directory.md) and [99 — compatible security patches](99-compatible-dependency-security-patches.md). Storage feasibility and remaining dependency findings are still open; this UI delivery does not remove those release constraints.

## User-visible changes

- Search, sort, inventory window and cards/table selection remain immediately available. Freshness, minimum reported liquidity and minimum coverage use a native **Advanced filters** disclosure with an applied-filter count and explicit apply/reset controls. Hidden applied filters still affect the same shared query. Reset also clears unsent drafts, including when the applied query was already at defaults.
- Native numeric validation reveals the advanced section before focusing an invalid field. Search/primary controls retain labels and 44 px targets; the disclosure works from the keyboard. No new filter, organic sort, evidence pass or scoring rule was introduced.
- A compact cutoff/source-status line and the experimental-grade caveat precede results. Paging/refresh help is available through a disclosure, with the same controls also below the list. Page-1 polling, frozen later pages, cursor invalidation and last-success/error behavior remain unchanged. Loading, source-refresh concerns and read failures remain explicit.
- Saved/comparison count links take the user directly to their existing workspaces after the results. Moving those panels and detailed scope/methodology copy out of the first viewport leaves more space for ranked identities. Exact mints, original evidence links, unknown metrics and the first supported concerns remain available. Save/compare storage and request contracts are unchanged.
- The `/discover` workspace alone widens to at most 1,240 rendered pixels, compensating for the existing shell scale. Desktop cards use two columns; narrower views keep one. Other routes retain their normal shell. The lazy Discovery CSS controls the ancestor width through `:has`, without mutating shared global shell state or changing its implementation.
- The named, keyboard-focusable table can use the wider shell and ordinary page scrolling; its inherited 480 px vertical cap is removed. It fits the measured desktop width. Narrow tables still have legitimate horizontal scrolling. Artwork/fallbacks remain visible and descriptive; no image gains score credit or triggers a new source lookup.

## Measured layout and interaction checks

Live local browser checks used explicit responsive viewport overrides, which were reset before closing the agent-owned tabs. The user's browser content was not replaced. A temporary frame harness was removed before the build once direct viewport control was available; no test page or harness ships in public assets.

| Viewport | First card top | Main concern ends | Page-wide horizontal overflow |
|---|---:|---:|---|
| 1,280 × 720 | 486 px | 719 px | None |
| 390 × 844 | 584 px | 783 px | None |
| 320 × 844 | 661 px | 861 px | None |

The grade and evidence-coverage text, identity and first main concern fit the two first-result target viewports for the observed default live ranking. At 320 px, reflow passes but the concern requires scrolling; this is not claimed as an additional above-fold pass. At desktop, the score panel's lower padding/border extends past the viewport even though its text/concern fits. Long names, multiple concerns, open panels, source errors or fixture notices can require more space and must never be clipped to manufacture a pass.

The earlier 1,280 × 720 observation placed the first card at 1,869 px. These are uncontrolled live observations with different current leaders/populations, not a frozen before/after experiment or a load-performance claim. The table check measured 958 layout px width with matching client/scroll widths, and matching 12,543 px client/scroll heights with `max-height: none`; the existing shell scale renders it wider. This demonstrates removal of the inner vertical scrolling cap for that sample, not a general accessibility certification.

Browser checks passed for exact-mint search (one matching identity), applying two advanced filters and displaying their count, clearing an unsent search draft, keyboard disclosure activation, reopening/focusing an invalid hidden numeric field, and tabbing from the table region to its first token evidence link. Three selected live identities produced the existing cached comparison with v4 grades and descriptive activity/unknown qualifications. Saving and following the saved-token link retained the exact mint. Only the test's newly saved identity was removed; comparison selections were cleared afterward.

**161 Discovery/client/release tests pass** across 33 files. The added regression verifies that collapsed applied filters remain counted and preserve URL/query values while primary controls stay outside the disclosure. Existing tests retain table provenance, unknown-not-zero values, comparison, saved lists, pagination and production isolation. App typecheck/build and the unchanged bundle budget pass at **232.5 KiB gzip / eleven startup chunks**. The actual built thesis-only release assertion, static security preflight and compromised-package blocklist pass. The dependency audit remains at the status recorded in milestone 99; it was not waived or reclassified here.

All original source/cohort/outcome/holder/wallet/cache preservation hashes remain identical; foreign keys pass. No source adapter, scoring evaluator, candidate/store schema, API contract, provider admission, quota or action/financial gate changed. Browser requests used the existing saved-data reads; there was no forced collection, migration, store switch, runtime restart or deploy. Ordinary already-admitted collection remained independent of these UI checks.

Private proof: `.tmp/discovery-compact-layout-20261022.json`, SHA-256 `cb2893eaf22bfce4e6fe50143c803fc0d192def2bdd4ad9b21e569768a34db9a`. Final screenshots remain ignored as `.tmp/discovery-compact-final-desktop.jpg` and `.tmp/discovery-compact-final-mobile.jpg`; their hashes are `584e003af0a91b8e1baca8c08070bc722baa6a739addd5d0e3c99eed7389e371` and `9cee7eb1c2f924552a92ccc26381a562197a755bde5d298814a260bf296fb2b4` respectively.

## Remaining acceptance and priorities

This closes a bounded design slice, not F2/F5 or Discovery release readiness. The five recorded end-to-end daily-journey trials, independent users, full keyboard/screen-reader/contrast review, 200% text zoom, actual device checks and rendered-image success measurements remain open. Selected native option text can be truncated on the narrowest viewport; full labels/options remain accessible. Enabled-route Web Vitals, CPU/query/row-read costs and controlled latency samples remain unmeasured.

Continue Free storage/read feasibility, compact precomputed reads, active-inventory overflow and remaining parser/installer reachability/remediation. Ordinary admitted broad F1 observation and preregistered F3/F4 qualification remain necessary before changing v4. Production remains thesis-only; all Free/evidence/action/release gates and local calibration authority are unchanged. Unrelated Network/legal changes are excluded from this commit.
