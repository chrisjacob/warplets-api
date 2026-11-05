# B10 partial checkpoint — 6 November 2026

This slice adds local collection, Vault and Earn member disclosures. It does not complete B10 or enable financial execution. Coordinator owns shared schemas, generated client, resumable state and commits.

## Implemented

- Collection read projections: truthful allocation aliases; projection time; public-revealed Level counts and concealed count; Season expiry schedule and remaining milliseconds; fixed-opening free-stage eligibility with unknown pending state; bind/transfer ownership evidence time. Upgrade probability rows include server outcome expiries. Original economic mutation logic and historical allocation snapshots are unchanged.
- Operator-only whitelist dry-run CLI: bounded canonical Solana addresses, sorted deduplication, fixture source/digest, error/count report. It opens no database. Existing immutable stage publication consumes the reviewed wallets; no HTTP whitelist mutation is added.
- React collection journeys: actual Genesis tranches/ballots, terms digest and publication time, accurate labels, Season schedule, material selection across at most four pages/100 assets, same-owner/Season/Level filtering, stale-quote hold, material downgrade risk, reroll state and original-claim continuity. SSR retains concealed metadata suppression and accurate allocation labels.
- Vault: complete local owner snapshot bounded to 100 assets and 100 manifests in one SQLite transaction. Any concealed tracked asset or exceeded bound suppresses all aggregate amounts. Per-row immutable activation/cliff/full-vesting dates and recorded ownership timestamp. No fiat estimate or cross-token arithmetic.
- Earn: server-derived finalized components; public capacity/action catalog; optional owner memberStatus UI. New isolated Node member projection separates current stake/admission, accepted entry, pending cutoff, verified action completions and latest sealed components. Shared domain computes multiplier bounds; no client multiplier arithmetic. Coordinator wired this through the existing Node repository/service /earn/me read. Worker /earn/me remains unavailable until its declared task.

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

1. Shared schemas, generated client and Node service integration now pass172reference tests,14site tests, both typechecks, build and integrated browser rerun. Checkpoint push/CI follows.
2. Broader browser populated/finalized Earn evidence (0.1X, cap, reset/rotation, pending cutoff, provenance) and Vault complete/concealed/over-bound summary states. Current isolated/domain/render tests cover these semantics; browser member test exercises ordinary populated records.
3. Expand exact evidence-bound eligibility reasons and operator publication review UX beyond the offline dry-run report. Local finalized snapshot importer remains fixture-authoritative; no chain completeness claim.
4. Additional acceptance combinations: expired/reactivated Season pairs and historical snapshots unchanged across all progression combinations, bound-exceeded material choice UX, current/late cutoff ownership changes. Existing reference/domain coverage is reusable, but this slice does not declare all B10 criteria verified.
5. Physical mobile wallet and live source/provenance remain later release gates. Later prices and Sydney launch hours stay unset.

Coordinator integrated browser rerun: work/b10-integrated-browser (28screenshots;390px material chooser visually inspected). Additive /earn/me status is optional on the wire, principal-bound in the service, and uses injected server time. Vault summary is a discriminated complete/unavailable union in generated declarations.
