# Complete GMGN event research pages

23 October 2026, Australia/Sydney. Continues [165](165-gmgn-event-response-diagnostics.md). No deploy.

## Delivered

- [x] Add `gmgn-wallet-activity-v2`, a complete response contract capped at50 events. It explicitly records requested20, response cap50, actual returned count and whether the response exceeded the requested count. Nothing is sliced, paginated, retried or treated as full-day/population coverage.
- [x] Keep pages of20 or fewer on the original contract, including its original report hashes and bounded independent comparison. The original normalizer still rejects21 rows. New transport selects the separate research contract for larger responses;51 or more remains rejected in full.
- [x] Validate every row, including rows21–50, using the existing signature, exact mint, event-type consistency, quantity, future-time and duplicate checks. Missing, unusable and negative USD remain separately unresolved; transfers/liquidity events do not become trading volume. A descriptive cue is not proof of wash trading or safety.
- [x] Save successful larger pages with `semantic_validation=gmgn_wallet_activity_50_v1`; replay derives the observation contract from that immutable receipt field. Observation version3 distinguishes the new wallet contract from prior candle version2 and wallet version1. Original trader selection, receipt/body/report hashes and wallet binding remain mandatory.
- [x] Carry the versioned research sample through saved token evidence, the attention queue and personal review capture/export/restore. Display requested/received counts, complete-page cap and unresolved independent comparison explicitly. Public projections omit raw wallets, transaction signatures and cursors.
- [x] Preserve original20-event/two-signature RPC and quote-comparison bounds. The new research contract is held before cache queries or RPC collection, even if many events share one signature. Direct comparison replay rejects it explicitly; the UI does not offer the unsupported comparison. Common-activity adoption is separately held with `wallet_research_page_common_activity_adoption_held`; it is not misreported as verified token volume.
- [x] Add optional diagnostic validator-cap metadata for new rejected pages. Absence retains the legacy20 explanation without adding defaults or changing original receipts/review hashes. Rejected bodies remain null and structural diagnostics remain bounded and sanitized.

## Free controls, performance and security

The request remains token-filtered `limit=20`, weight3, one selected wallet per UTC hour. Existing hourly IDs are unchanged, so switching validators cannot reopen a spent hour. Authentication, selection recheck before reservation, shared600-request market allowance, source quota, request spacing, backoff, leases, timeout, byte/complexity limits, key-echo rejection and failure charging are unchanged. No direct CLI calls, provider retries, new endpoint, timer, migration, dependency or configuration change.

Queue reads stay48 receipts/8MB with the same collecting-turn envelope. Every retained50-row page fits the existing byte limits or is held; larger count support does not enlarge those limits. There is no visitor-triggered provider IO. Larger pages receive no eligibility, score, organic-volume, holder-growth, launch or action credit. Thesis-only production exposure, serving149 and the existing release/evidence gates remain held.

## Verification

The full backend suite passed1,520 tests/103 suites. Final focused parser/queue/common-activity checks passed47 tests, including a legacy report hash independently calculated from the committed pre-change normalizer and the explicit held-state projection. Discovery UI passed189 tests/39 suites. Tests cover all50 events,51-row rejection, invalid final rows, signed/missing costs beyond row20, source binding, receipt-version downgrade/tamper rejection, unchanged RPC holds and hourly charging, queue bounds and captured-context restore/tamper detection. Both typechecks and14 relay/operator checks pass.

Offline browser checks cover the original frozen live failure and explicitly synthetic accepted50/legacy/missing/stale samples at1280,390 and320 widths: no provider requests, unexpected requests, browser exceptions or document overflow. Screenshots were inspected. The table's expanded evidence remains cramped; these are functional component checks, not full-app usability/accessibility or release approval. Move expanded review content into a readable detail surface in the next UI pass.

Closed production build, performance budget, release guard and security preflight are recorded with the final local validation artifacts. Original private evidence and proof rows are checked separately; new work does not rewrite historical manifests, failures or judgments.

## Live status and next build order

At16:21UTC22 October, the latest ordinary live activity attempt remained the untouched165 failure from16:01:52.976UTC (`aaefe25f-a051-4ef8-82e7-890595b7c9a7`, receipt hash `e5342c39fa64f6b257fe8895ed444217b43d47146833702194f4a3c6beefc29e`). It returned50 rows but was rejected under the original20-event contract. Its body remains null; its rows cannot be reconstructed or retroactively accepted. The spent16UTC hour is not reopened. Synthetic success is not live acceptance.

1. Observe the next ordinary hourly attempt under the new contract. Confirm all rows pass, original selection/receipt replay succeeds and no unqualified credit appears. If a row fails, inspect its bounded diagnostic rather than relaxing identity or event semantics.
2. Once accepted live pages exist, assess a separately bounded independent transaction-sample contract, with explicit selection and coverage gaps. Do not expand the original RPC/quote comparison implicitly or fetch all50 signatures. Preserve Free budgets and archived replay.
3. Improve the shortlist review detail layout, then collect prospective founder usefulness/outcome labels and qualified holder observations. Avoid another feed or scoring layer until we know whether the existing shortlist identifies useful attention candidates.
4. Continue authoritative completed-ATTN-launch exclusions and the remaining production serving/evidence acceptance work before enabling new public functionality.
