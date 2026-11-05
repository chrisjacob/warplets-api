# B10 partial checkpoint — 6 November 2026

This slice adds local collection, Vault and Earn member disclosures. It does not complete B10 or enable financial execution. Coordinator owns shared schemas, generated client, resumable state and commits.

## Implemented

- Collection read projections: truthful allocation aliases; projection time; public-revealed Level counts and concealed count; Season expiry schedule and remaining milliseconds; fixed-opening free-stage eligibility with unknown pending state; bind/transfer ownership evidence time. Upgrade probability rows include server outcome expiries. Original economic mutation logic and historical allocation snapshots are unchanged.
- Operator-only whitelist dry-run CLI: bounded canonical Solana addresses, sorted deduplication, fixture source/digest, error/count report. It opens no database. Existing immutable stage publication consumes the reviewed wallets; no HTTP whitelist mutation is added.
- React collection journeys: actual Genesis tranches/ballots, terms digest and publication time, accurate labels, Season schedule, material selection across at most four pages/100 assets, same-owner/Season/Level filtering, stale-quote hold, material downgrade risk, reroll state and original-claim continuity. SSR retains concealed metadata suppression and accurate allocation labels.
- Vault: complete local owner snapshot bounded to 100 assets and 100 manifests in one SQLite transaction. Any concealed tracked asset or exceeded bound suppresses all aggregate amounts. Per-row immutable activation/cliff/full-vesting dates and recorded ownership timestamp. No fiat estimate or cross-token arithmetic.
- Earn: server-derived finalized components; public capacity/action catalog; optional owner memberStatus UI. The member projection separates current stake/admission, accepted entry, pending cutoff, verified action completions and latest sealed components. Shared domain computes multiplier bounds; no client multiplier arithmetic. B06 subsequently wired the bounded projection through both Node and Worker shared services. B20-core proves real workerd browser authentication, admission and pending-cutoff presentation.

## Exact additive contract requirements

- Inventory: asOf ISO; counts.paidStageAllocations/freeStageAllocations/founderStageAllocations nonnegative integers (old paid/free/founder aliases retained); revealedLevelCounts integer[10]; concealedCount integer; seasonExpiries null or [{level,expiresAt ISO,remainingMs integer}]. Existing source remains local-fixture.
- Stage: eligibility {status eligible|ineligible|unknown,reason string,cutoffAt ISO|null}. Existing eligible is boolean|null, including null for incomplete free snapshot, even for a connected wallet. publishedAt and termsDigest already exist.
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

## Remaining B10 acceptance

1. Expand exact evidence-bound eligibility reasons and operator publication review UX beyond the offline dry-run report. Local finalized snapshot importer remains fixture-authoritative; no chain completeness claim. Keep operator intake behind the separate operator boundary.
2. Additional acceptance combinations: expired/reactivated Season pairs and historical snapshots unchanged across all progression combinations, bound-exceeded material choice UX, current/late cutoff ownership changes. Existing reference/domain coverage is reusable, but this slice does not declare all B10 criteria verified. D1 mutation authority remains B11 work.
3. Physical mobile wallet and live source/provenance remain later release gates. Later prices and Sydney launch hours stay unset.

Coordinator integrated browser rerun: work/b10-integrated-browser (28screenshots;390px material chooser visually inspected). Additive /earn/me status is optional on the wire, principal-bound in the service, and uses injected server time. Vault summary is a discriminated complete/unavailable union in generated declarations.

## B10.2 member evidence acceptance — 6 November 2026

This acceptance-only slice adds `application/fixtures/member-evidence.mjs`, `site/tests/earn-details.spec.mjs` and `site/tests/member-evidence-qa.mjs`; the normal browser runner invokes the new matrix. No production UI, economic state logic, shared contract or migration changes were needed.

The disposable fixture seeds explicitly synthetic sealed component rows and local Vault observations. It verifies read projections and presentation; it does not substitute for B07 settlement or claim real-chain provenance. All browser sessions use generated Ed25519 keys to sign genuine local challenges. No API response is mocked.

- Earn: a prior ten-day streak followed by a sealed reset displays the server's latest 0.1X; a separate sealed maximum displays 10X, Level 10 and 99 purchase token-days. Disabled onboarding actions disappear, verified completion evidence stays with its owner, and absent final evidence stays pending without a zero-valued substitute.
- Vault: 26 owned assets span two pages while the complete summary retains all 26 assets and exact 26,000 allocated / 13,000 available base units. Any concealed asset withholds aggregate amounts, and 101 assets produce the explicit asset-bound state. Per-asset clocks remain anchored to original activation; owner observation age and unavailable fiat pricing are shown. Concealed per-asset Vault reads remain unavailable and public HTML omits hidden metadata.
- Three owners are exercised in the same SPA at 360/390/768/1440 widths. Sign-out and subsequent owner sign-in do not retain the prior private component or summary view. Keyboard pagination, browser Back, original-clock disclosure, overflow and page errors are checked.

Evidence: focused real-API/render tests 2/2; full site suite 16/16; standalone member browser matrix and complete `site/tests/browser-qa.mjs` both passed. Logs: `work/b10-2-browser.log`, `work/b10-2-integrated-browser.log`. Twenty-four member screenshots appear in each corresponding screenshot directory; the 390px concealed Vault state was visually inspected. Owned-file `git diff --check` passed. Existing B20 site build/typecheck evidence applies because shipped frontend source and dependencies are unchanged. B10 remains partial for the collection cases listed above.
