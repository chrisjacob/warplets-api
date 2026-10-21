# Rotating token coverage and a searchable discovery workspace

21 October 2026. First delivery from [F1/F2](82-next-product-functionality-plan.md), under [PRD §4.7](spec/10X_MEME_FULL_PRD_v1_2.md#47-graded-discovery--v12-founder-direction-and-implementation-plan). Both packages remain partially complete. Current v4, every evidence/action/election gate, provider Free admission and the no-deploy instruction remain.

## Completed in this delivery

- [x] Replace automatic recurring investigation of PONYX/USDF/Kimchi with a deterministic daily rotation of up to three other chain-observed tokens.
- [x] Freeze the complete bounded **active** inventory and selection metadata before new scheduled provider IO. Retain unknown, rejected and unselected rows in that manifest.
- [x] Prefer tokens least recently selected, diversify age/liquidity/v4 bands, and use date/address hashes for deterministic ties. Freeze the selection once per UTC day.
- [x] Collect cheap info across the three targets before security, pool and four-part candles. Keep candle windows pinned to the manifest cutoff.
- [x] Preserve the existing twenty-one scheduled endpoint-attempt baseline atomically, inside all existing shared allowances. Failures consume attempts; operator requests consume shared admission as before.
- [x] Search names, symbols and exact mints **before** the top-100 presentation limit, including lower-ranked tokens. Add market freshness, minimum reported liquidity and minimum evidence-coverage filters.
- [x] Add a compact table alongside cards, shareable view parameters, original ranks, explicit match/inventory/truncation counts, safe artwork fallbacks and mint copying.
- [x] Apply local additive migration `0043_gmgn_daily_rotation.sql`; preserve historical rows and hashes. No remote migration or deployment.

## Daily rotation and evidence boundary

The primary population is `tenx_active_candidates`, using the existing logical-expiry rules. This includes action-ineligible, rejected and creation-unknown observations. Expired candidates and their evidence remain stored and searchable in the all-observations view; they are outside this collector's declared active scope. The existing 500-candidate / aggregate-input bounds still fail visibly rather than silently sampling an oversized inventory.

The immutable `tenx_gmgn_daily_cohorts` control table uses its own namespace, separate from first-grade score cohorts and future paired-model studies. One manifest per UTC day stores cutoff, candidate input hashes, checked dates, v4 grades, verification states, strata, previous selection days, tie hashes, every row's disposition and selected addresses. Its canonical hash is checked on reads. Update/delete triggers protect the manifest; an input change after freezing cannot replace that day's selection. Each manifest is bounded to 400 KB. This scheduling metadata adds no HTTP allowance or score evidence and is not a new provider observation.

Selection is greedy and deterministic: prefer the oldest prior selection date (never selected first), then previously unused age bands, liquidity bands and v4 bands within that recency tier, then ascending SHA-256 of UTC day/address and ASCII address. Age bands are first day / older / unknown; reported-liquidity bands are below $25K / at least $25K / unknown; v4 bands are below 50 / at least 50. These are sampling strata, not new scoring or safety thresholds. Selection is not evidence of a successful fetch or a reviewed independent label.

PONYX, USDF and the original Kimchi mint remain explicit regression fixtures and visible candidates. They receive no recurring rotation requests. Existing explicit operator investigations remain available. This is not a token blacklist or a score change.

Existing info/security/pool requests on a selected mint/day remain counted rather than retried. The four-part candle series gets a deterministic rotation-specific ID and a six-hour window ending at the manifest's closed minute, with the existing forty-minute overlap and missing/conflicting-bar checks. A later provider receipt does not retroactively become selection-time evidence. Common activity normalization and prospective score adoption remain future work.

The existing maintenance loop still spends at most one of three capture slots on GMGN. No new timer or per-browser provider collection is introduced. At most twenty-one scheduled info/security/pool/candle attempts can be admitted per UTC day, including earlier operator attempts of those kinds; the reservation transaction also rejects a day rollover. The shared 600 market ceiling, configured lower allowance, provider request weights, one-flight lease, ten-second spacing, pause/backoff, payload bounds and research-mode gates remain. D23's explicit local-calibration exception is unchanged; no disabled daily research caps are reintroduced. The scheduled baseline is not an extra allowance and does not restrict existing explicit operator admission beyond its existing gates.

No new GMGN trending/launchpad endpoint is activated: its exact Free entitlement, weights and effective filter contract still need verification. The plan explicitly permits the already verified read endpoints and chain inventory as the first delivery.

## Discovery workspace contract

`GET /api/10x/candidates` remains cache-only. It ranks the complete bounded date/action view with current v4, applies search and presentation filters, then retains up to 100 matches. Name/symbol search is case-insensitive; exact Solana mint matching remains case-sensitive. No request is made to a provider when a token is absent from this inventory.

Cards and the table retain ranks from the complete date/action view, so a search can display rank 157 or 256. The response reports stored, ranked, matching and available counts, declared inventory scope and truncation. API pagination still covers at most the 100 available matches; narrow a search to find further matches. Missing/future-dated data cannot satisfy the fresh-market filter; unknown liquidity cannot satisfy a positive minimum. A zero minimum retains unknowns rather than converting them to numeric zero. Minimum coverage is an evidence filter, not a safety certificate.

The cursor binds every filter, mode, sort, representation, common score cutoff and result/scope snapshot for five minutes. Changed queries/snapshots require refresh. The new short-lived cursor format does not rewrite a persisted evidence artifact. View parameters preserve cards/table, search, filters, creation scope and source on reload or sharing. Switching layout uses the same cached response; ordinary refresh retains the last successful response when the same request fails.

Table values include artwork, name/symbol, full mint disclosure/copy, verified creation age, v4 score/coverage, reported cap/liquidity, reported 24h volume, source/fetch time and the main supported concern/action status. Null values remain unknown. Provider measurement-window endpoints stay unknown when absent. Raw reported volume earns no organic-volume credit; qualified holder growth and recent momentum remain explicitly unavailable in this first table. A shared score cutoff does not make different source timestamps or measurement windows comparable. The table scrolls horizontally on narrow screens; cards remain the default.

## Validation and local observation

- Targeted backend suites cover full-inventory accounting, deterministic rotation/duplicates, frozen selection and day changes, corrupt hashes, empty inventories, cheap-first three-mint collection, atomic scheduled admission/day rollover, source/security gates, search below rank 100, null/freshness filters, cursor identity and unchanged v4/election evidence.
- Discovery UI regressions pass, including URL round-trip, table provenance, safe images, unknown volume and accessible controls. Backend typecheck and application typecheck/build pass; the existing home startup budget remains 234.1 KiB gzip across eleven chunks.
- Local migration 0043 applied successfully. Original hashes preserved for 175 score cohorts, 39 completed source receipts, 812 holder inventories, 72 wallet observations and 595 cached transaction bodies; there were zero old score outcomes. Foreign-key checks pass. Later ordinary timer appends are allowed.
- Browser verification showed 100 of 468 saved live observations and an explicit truncation notice. Searching “Google Gemini” returned ten matches, including original ranks 157–256 with distinct mints/artwork. This tests search coverage, not those tokens' quality. The local supervisor recovered through its existing owned restart flow; API 8794 and App 8788/5183 subsequently returned 200. No ownership, restart budget or store was reset.
- At the local check, today's preserved source rows already included 24 candle, 3 info, 3 pool and 4 security attempts: 34 of the kinds covered by the twenty-one scheduled baseline. The new rotation correctly holds additional automatic IO. No fresh three-mint live smoke or today's frozen rotation is claimed; synthetic transport tests pass, and the live smoke remains due on the next UTC day with admitted capacity. Provider budgets were not reset or raised.
- The actual query key is absent from changed source and generated assets; both secret files remain ignored and untracked. No signing, funding, trade, launch or deployment.

## Next PRD work

- [ ] Finish F1's versioned common activity model: token/pool/wallet scope, actual windows, units, denominators, coverage, qualification status and immutable source-receipt references, including absent/rejected observations.
- [ ] Observe the rotation on at least three previously unreviewed live mints when admitted capacity returns. Retain failed/missing results; do not force a rollover or manufacture success.
- [ ] Build F2's up-to-three-token comparison at a displayed common cutoff with actual source/window differences. Optional local shortlist follows only if it does not slow the core work.
- [ ] Preregister meaningful acquisition/retention, volume and momentum qualification, then implement descriptive measurements (F3) without raw wash/dust credit.
- [ ] Collect the prospective broad cohort and later-day holdout in a new study namespace; compare frozen v4, pinned provider-derived heuristics and a proposed hybrid before considering v5 (F4).
- [ ] Continue owned runtime reliability, archive/restore and production-bound restoration work (F5). Keep all later backing/campaign/launch release gates and no deploy.
