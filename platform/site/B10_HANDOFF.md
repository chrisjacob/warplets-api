# B10 local acceptance complete — 6 November 2026

The combined B10 slices now cover the task card's local collection, Vault and Earn member journey and read-only operator intake acceptance. Financial execution remains disabled. Coordinator owns shared schemas, generated client, final state verification and commits. Earlier sections retain the evidence from each incremental checkpoint.

## Implemented

- Collection read projections: truthful allocation aliases; projection time; public-revealed Level counts and concealed count; Season expiry schedule and remaining milliseconds; fixed-opening free-stage eligibility with unknown pending state; bind/transfer ownership evidence time. Upgrade probability rows include server outcome expiries. Original economic mutation logic and historical allocation snapshots are unchanged.
- Operator-only whitelist dry-run CLI: bounded canonical Solana addresses, sorted deduplication, fixture source/digest, error/count report. It opens no database. Existing immutable stage publication consumes the reviewed wallets; no HTTP whitelist mutation is added.
- React collection journeys: actual Genesis tranches/ballots, terms digest and publication time, accurate labels, Season schedule, material selection across at most four pages/100 assets, same-owner/Season/Level filtering, stale-quote hold, material downgrade risk, reroll state and original-claim continuity. SSR retains concealed metadata suppression and accurate allocation labels.
- Vault: complete local owner snapshot bounded to 100 assets and 100 manifests in one SQLite transaction. Any concealed tracked asset or exceeded bound suppresses all aggregate amounts. Per-row immutable activation/cliff/full-vesting dates and recorded ownership timestamp. No fiat estimate or cross-token arithmetic.
- Earn: server-derived finalized components; public capacity/action catalog; optional owner memberStatus UI. The member projection separates current stake/admission, accepted entry, pending cutoff, verified action completions and latest sealed components. Shared domain computes multiplier bounds; no client multiplier arithmetic. B06 subsequently wired the bounded projection through both Node and Worker shared services. B20-core proves real workerd browser authentication, admission and pending-cutoff presentation.

## Exact additive contract requirements

- Inventory: asOf ISO; counts.paidStageAllocations/freeStageAllocations/founderStageAllocations nonnegative integers (old paid/free/founder aliases retained); revealedLevelCounts integer[10]; concealedCount integer; seasonExpiries null or [{level,expiresAt ISO,remainingMs integer}]. Existing source remains local-fixture.
- Stage: eligibility {status eligible|ineligible|unknown,reason string,cutoffAt ISO|null}. Existing eligible is boolean|null, including null for incomplete free snapshot, even for a connected wallet. publishedAt and termsDigest already exist.
- Stage: optional reservationStatus separates current availability from fixed membership. Its exact generated shared shape is `StageReservationStatus`; snapshotId is the accepted opening-cut digest, not a caller assertion. Current reasons include scheduled/closed/sold-out/opening hold, missing session/cut, list exclusion, wallet limit and operator-only founder allocation.
- Asset: ownerObservedAt ISO|null; evidenceStatus local-fixture. Existing revealedAt/expiry/reroll fields are retained. Never expose concealed economic metadata.
- Progress quote: asOf ISO; materialProbabilities rows add expiresAt ISO and remainingMs integer.
- VaultAllocation: activatedAt/cliffEndsAt/fullyVestedAt ISO. getNftVault adds ownerObservedAt ISO|null. getMyVault items add ownerObservedAt ISO|null and response adds summary exactly as MemberVaultSummary in vault/member-projection.d.mts.
- /earn/me response: optional memberStatus exactly as EarnMemberStatus in earn/member-projection.d.mts. Existing items and cursor remain compatible. No new public route or capability. Private query remains wallet+chain scoped.

## Evidence

- `node --test platform/collect/collect.test.mjs platform/collect/eligibility.test.mjs platform/vault/*.test.mjs platform/earn/member-projection.test.mjs platform/site/tests/*.spec.mjs`: 33 passed (12 collection, 5 Vault, 2 isolated Earn, 14 site).
- Installed TypeScript `--noEmit -p platform/site`: passed.
- Installed Vite production build: passed. Existing pinned Zod PURE annotation warnings only.
- Installed Chromium `platform/site/tests/browser-qa.mjs`: passed. Five routes at 360/390/768/1440 widths, signed local member journey, canonical SSR, wallet lifecycle, capability-profile holds, quote cases; added paginated material selection/arbitrary-ID rejection/keyboard review/stale-pair hold at all four widths. A first new fixture run missed its material detail response; fixed the fixture and full rerun passed.
- 28 local screenshots under ignored work/b10-browser; populated 390px screenshot inspected. No external requests allowed by harness; no wallet extension or transaction signing.
- `git diff --check` on owned files passed.

## Downstream boundaries

1. Authoritative progression quote identity/fee binding and D1 mutation authority remain B11 work. The B10.4 pair presentation covers current Levels, versions, expiry and historical Vault context using existing reads.
2. Operator authentication, audited command publication and operator browser surfaces belong to B12. B10.5 provides an offline read-only review and preserves the existing immutable importer; it does not create a public operator route.
3. Physical mobile wallets, real chain completeness/provenance and metadata/claim leakage compatibility remain release gates. Later prices and Sydney launch hours stay unset. Synthetic source identity/page evidence is never labeled verified chain history.

Coordinator integrated browser rerun: work/b10-integrated-browser (28screenshots;390px material chooser visually inspected). Additive /earn/me status is optional on the wire, principal-bound in the service, and uses injected server time. Vault summary is a discriminated complete/unavailable union in generated declarations.

## B10.2 member evidence acceptance — 6 November 2026

This acceptance-only slice adds `application/fixtures/member-evidence.mjs`, `site/tests/earn-details.spec.mjs` and `site/tests/member-evidence-qa.mjs`; the normal browser runner invokes the new matrix. No production UI, economic state logic, shared contract or migration changes were needed.

The disposable fixture seeds explicitly synthetic sealed component rows and local Vault observations. It verifies read projections and presentation; it does not substitute for B07 settlement or claim real-chain provenance. All browser sessions use generated Ed25519 keys to sign genuine local challenges. No API response is mocked.

- Earn: a prior ten-day streak followed by a sealed reset displays the server's latest 0.1X; a separate sealed maximum displays 10X, Level 10 and 99 purchase token-days. Disabled onboarding actions disappear, verified completion evidence stays with its owner, and absent final evidence stays pending without a zero-valued substitute.
- Vault: 26 owned assets span two pages while the complete summary retains all 26 assets and exact 26,000 allocated / 13,000 available base units. Any concealed asset withholds aggregate amounts, and 101 assets produce the explicit asset-bound state. Per-asset clocks remain anchored to original activation; owner observation age and unavailable fiat pricing are shown. Concealed per-asset Vault reads remain unavailable and public HTML omits hidden metadata.
- Three owners are exercised in the same SPA at 360/390/768/1440 widths. Sign-out and subsequent owner sign-in do not retain the prior private component or summary view. Keyboard pagination, browser Back, original-clock disclosure, overflow and page errors are checked.

Evidence: focused real-API/render tests 2/2; full site suite 16/16; standalone member browser matrix and complete `site/tests/browser-qa.mjs` both passed. Logs: `work/b10-2-browser.log`, `work/b10-2-integrated-browser.log`. Twenty-four member screenshots appear in each corresponding screenshot directory; the 390px concealed Vault state was visually inspected. Owned-file `git diff --check` passed. Existing B20 site build/typecheck evidence applies because shipped frontend source and dependencies are unchanged. B10 remains partial for the collection cases listed above.

## B10.3 collection boundary acceptance — 6 November 2026

Added `application/fixtures/collection-edges.mjs`, `site/tests/collection-edges.spec.mjs` and `site/tests/collection-edges-qa.mjs`; the normal browser runner invokes the new matrix. Synthetic holdings are minted and revealed through the existing local store. Historical Vault manifests and a prior claimed amount are recorded before progression. No API response is mocked and no production UI/backend/contract/migration changes were needed.

- Free eligibility stays unknown until a complete fixture cut is accepted. Omitted tracked Genesis holdings, contradictory ownership and a shifted cutoff are rejected. Evidence accepted after transfer/reveal still uses the published opening cut: the original revealed Genesis 1X holder qualifies; the later buyer, late-revealed Genesis holder and Season-only 1X holder do not. Replay preserves the cut and published terms; the original holder gets one free-stage reservation, including after earlier paid-stage allocations.
- Real API progression covers every allowed starting Level 1–9. Target increase and independent material downgrade preserve visual traits and byte-identical historical manifests/claim totals. A subsequent visual reroll changes traits while retaining Level, expiry and old entitlements. The expired Level 1 pair reactivates its Level 2 target. Transfer preserves the completed reroll count and fulfillment-time cooldown.
- At 360/390/768/1440, 101 actual owned Season assets prove the four-page/100-asset chooser boundary. The 101st material is rejected before a quote request; an included expired pair receives genuine server probability/expiry values, enters the normal local pending operation lifecycle, and recovers its fulfilled result. Keyboard review, browser Back, original Vault clocks, logout, overflow and page errors are checked.

Evidence: focused API matrix 3/3; final site suite 19/19 (`work/b10-3-site.log`); full browser suite passed (`work/b10-3-integrated-browser.log`), followed by the four-width collection rerun after adding the optional Level-matrix fixture parameter (`work/b10-3-browser.log`). Four collection screenshots are under each corresponding screenshot directory; the 390px reactivated target was visually inspected. Owned-file whitespace checks passed. Shipped frontend source remains unchanged, so B20's build/typecheck evidence still applies. Remaining work is the presentation/intake detail listed above, not these now-covered boundary combinations.

## B10.4 progression pair presentation — 6 November 2026

The review now refreshes target and material ownership/reveal/version evidence before requesting the server quote. Each asset displays its current Level, version, benefit expiry, owner-observation time, reroll count and cooldown, followed by its historical Vault allocations. Exact allocated/vested/claimed/available base units remain separate by NFT and token, with each original activation/cliff/full-vesting clock and manifest digest. A partial page explicitly cannot represent a complete balance. Fiat pricing remains unavailable. Quote timestamp/source and material remaining lifetime come from the server response.

Private Vault queries are capability-gated and keyed by wallet, asset and version. Unrevealed or differently owned assets cannot display cached history. A real ownership transfer after the chooser has rendered is rejected before issuing either the quote or historical Vault requests; confirmation remains disabled. These reads add context and do not expand the authority of the local progression operation.

Evidence: focused render regression 1/1; complete site suite 20/20 (`work/b10-4-site.log`); installed TypeScript and Vite build passed (existing pinned Zod annotation warnings only). Complete browser suite passed against the migrated evidence-bound quote fixture (`work/b10-4-integrated-browser.log`). The actual collection API matrix runs at 360/390/768/1440 widths, compares both displayed histories to their API values including the target's prior one-unit claim, checks modal overflow, then verifies progression preserves the old history. The final targeted rerun adds the stale-ownership/no-private-read assertion (`work/b10-4-browser.log`). Eight collection screenshots per corresponding directory include the pair review and fulfilled target; the 390px pair review was visually inspected. Remaining B10 work is bounded eligibility/intake explanation and operator preview, plus later physical-wallet/live-source release gates.

## B10.5 eligibility review and local completion audit

`collect/eligibility-preview.mjs` and its standalone CLI add a bounded operator-only diagnostic over one SQLite read snapshot. The CLI opens the supplied existing database read-only. The packet binds the published opening, explicit source identities/slot/block-time references, ordered page coverage and exact holding identities. It reports candidate/ready eligible wallets, unknown wallets, late reveals, canonical address errors, duplicates, local ownership/reveal/collection conflicts, terms/source/input digests and the exact legacy snapshot digest. Missing pages or incomplete/conflicting evidence hold the result. No publication mutation or HTTP route is added, and even a ready result states `chainCompleteness: unverified` and `executable: false`. See `collect/ELIGIBILITY_PREVIEW.md` for the input format and local-only interpretation.

The optional member `reservationStatus` uses the session owner already supplied to the inventory projection. It separates immutable membership from current wallet quota, scheduled/closed/sold-out stage state, opening holds and founder-only commands. The UI displays these reasons and the genuine accepted cut digest without exposing the full whitelist. Existing eligibility stays true after the eligible wallet uses its quota; pending evidence stays unknown.

Final slice evidence: collection tests 18/18, including six new preview/availability tests (`work/b10-5-collection.log`); site tests 20/20 (`work/b10-5-site.log`); TypeScript and Vite build passed; complete browser suite passed at 360/390/768/1440 (`work/b10-5-browser.log`). Browser cases assert pending-cut and accepted eligibility reasons and the exact stored cut digest. The 10,000-holding/100-page boundary passes without truncation, and repeated cursors hold. CLI tests prove the database bytes remain unchanged. Shared schema generation is coordinator-owned and integrated before final checkpoint.

All local B10 card criteria are covered:

- Typed read projections, truthful allocation labels, terms/digests, reveal-only Level counts, Season expiry and recorded ownership age: initial B10 tests plus B10.2/3 real API matrices.
- Genesis/stage notice/ballot/shared inventory and canonical routes: existing collection/governance tests and full browser canonical/member journey; later unset terms remain unset.
- Canonical whitelist deduplication, immutable publication, fixed-cut eligibility, late transfer/reveal and incomplete/conflicting coverage: existing eligibility/collection tests plus B10.3/5; operator intake is read-only and separate from member sessions.
- Bounded pair selection, exact server outcomes, downgrade warning, cooldown/reroll state, historical rights and stale ownership: B10.3/4 at all four widths, including every allowed starting Level 1–9 through the real API.
- Complete bounded aggregate and per-NFT Vault history, original clocks, withheld concealed/bounded totals and no missing-price zero: B10.2 and pair review tests.
- Server-derived Earn minimum/cap/reset/current action rotation, owner-isolated evidence, admission versus final status and pending evidence: B10.2 plus the completed B06/B20 core flow.

No further local B10 implementation is required by the card. Downstream B11/B12 authority work and R-stage evidence remain explicit above. No external calls, financial execution, publication deployment or resource provisioning occurred.
