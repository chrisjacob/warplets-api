# Broad rotation coverage and collection accounting

22 October 2026 (Australia/Sydney). F1 continuation of the [daily discovery plan](82-next-product-functionality-plan.md). Production remains behind the [thesis-only release gate](88-thesis-only-production-release.md). No deploy.

## Product behaviour

Research now includes **Broad token coverage**: fourteen UTC days of frozen inventory size, regression fixtures, selected mints, endpoint gaps and recorded collection states. A native disclosure retains exact mint links, original manifest cutoffs/checksums, prior GMGN investigation counts and the four existing endpoint families. No symbol-only identity, new ranking, token verdict or per-browser collection is introduced.

`GET /api/10x/discovery/rotation-coverage` is a typed cache-only read. It verifies each retained daily manifest through the existing hash/schema reader. It never creates a missing manifest, enrolls candidates, starts collection, reads a credential or changes database rows. Missing manifests are **Not frozen**; an existing zero-target selection remains a different state. Unknown token quality is not converted into zero volume, a clean label or a passing score.

## Counting rules fixed before observation

- Window: current UTC day plus thirteen preceding days at the request's cutoff. Future-cutoff manifests are withheld. One grouped query counts existing core reservations by day; each day's manifest read and, if selected, two grouped metadata queries bound the read to at most 43 database statements before the standard API envelope. Manifest bodies retain their existing 400 KB bound. Historical prior-attempt lookups use retained metadata; long-term indexing/archive scalability remains part of F5.
- Selected-mint accounting: exact frozen addresses only; reservations must be at/after freeze, at/before the request cutoff and inside the same UTC day. Info/security/pool/candle kinds have separate attempted, recorded-success, failed and reserved/fetching counts. Duplicate attempts stay charged and counted; unattempted mints and endpoints stay visible. Other endpoints and unselected mints are excluded from those totals, not from shared quota accounting.
- Novel investigations require first-selection status recorded in the frozen manifest, no earlier retained GMGN attempt of any kind (including failures), and a post-freeze core attempt. Distinct totals deduplicate mints across the window; the separate UTC-day count requires a new-mint attempt on that day. This is new to retained GMGN investigation history, not market discovery, independent review or a fraud-negative label.
- States are operational metadata as read. Receipt payloads are not replayed and provider authenticity, semantic completeness, finality, usable candles and organic demand are not certified. This endpoint is not historical evidence replay or a new prospective scoring cohort. A stored succeeded state does not establish those claims.
- Configured weight uses one unit for basic reads and two for candle parts. It is not a billing receipt or additional allowance. Each day separately shows all-mint core attempts and remaining headroom under the existing twenty-one-attempt scheduled baseline, including prior/operator work even without a manifest. Remaining baseline is not admission permission: shared quotas, leases, pacing, pauses and backoff still apply. Unused days do not carry forward.
- The thirty previously unreviewed mints / three UTC days target is an observation goal. Failed attempts can contribute to attempted-mint counts, so reaching those numbers never declares data-quality completion or promotes a model. The data-quality pass remains null. A future F4 study still needs its own preregistration, paired cutoff and unseen-mint/later-day holdout.

## Local observation and limits

The first read-only store check ran at `2026-10-21T13:48:37.616Z` (22 October locally) in 20 ms. It found no frozen rotation in the fourteen-day window and zero selected/new-mint attempts, while the current UTC day already held **34 existing core attempts**. The scheduler's remaining baseline correctly stayed zero. These are metadata observations, not new provider results. No rollover, counter reset, quota increase, forced freeze or collection was used to fill the view.

The initial local HTTP read timed out while the preview was unhealthy. The supervisor log independently reported three health failures and its normal owned restart. After recovery, a second direct read completed in 13 ms, and the local HTTP endpoint returned 200 with the strict report schema and zero IO/write declarations. The browser verified the panel at `2026-10-21T13:54:10.749Z`, showing unfrozen days, zero selected/new investigations and 34 all-mint core attempts / zero scheduled baseline left. No competing launcher, restart-budget bypass, store replacement or reliability fix is part of this milestone.

## Verification and remaining work

Regression cases cover full inventory accounting, failed/pending/success partitions, missing manifests/endpoints, regression exclusions, prior failed investigations, repeated selections, exact cutoff/day bounds, future observations, scheduled exhaustion and corrupt manifest hashes. The API test checks the typed envelope, zero writes/provider IO, local-runtime guard and rejected public mutations. UI tests cover zero versus unknown, retained responses, endpoint gaps and exact mint/hash disclosure. Final verification includes the existing rotation/security and discovery UI suites, both typechecks, app build/performance budget, OpenAPI generation and thesis-only artifact assertion.

All previously retained holder-participation preservation digests still match, with foreign keys passing. No migration, evidence rewrite, scoring-policy change, provider call, financial action or deployment is introduced. Current v4 and every action/election/source gate remain unchanged.

Final results: 18 backend rotation/security tests and all 121 discovery UI tests passed, along with both typechecks, the application build/performance budget and the thesis-only artifact assertion. OpenAPI generation adds one response schema and one read path; the existing schemas and paths remain unchanged. Actual query credentials are absent from changed source and all 66 generated JS/CSS assets; secret files remain ignored and untracked.

Next: observe admitted broad rotation when ordinary capacity returns, inspect comparable source coverage across new mints, continue qualified acquisition/retention and organic-volume evidence, and preregister the cross-token scoring study. No repeat bespoke PONYX investigation or automatic v5 promotion is required by this feature.
