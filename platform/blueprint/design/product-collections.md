# Product and collections implementation blueprint

**Execution mapping:** P0 → B00; P1 → B09; P2/P3/P5 → B10/B11; P4 → B10/B15; P6/P7 → B17; P8 → B18/B20. Operator coordination is B12. Read [CONTRACTS](../CONTRACTS.md), the relevant [task manifest](../tasks.json) and B card first. IDs in this appendix are detail sections, not an independent queue. Proposed paths/numbered migrations are illustrative; the coordinator owns final assignment. All B acceptance is local, with no remote resource mutation, funded execution or new authority probes.

Planning review: 5 November 2026. Intended implementation agent: **GPT-6 Astra, High**. This is an input to the coordinating overnight blueprint, not a new release approval.

Baseline inspected: `implementation`, branch `work/10x-prd-foundation`, commit `5f3cafffc08d2404976ea14532dad2d2751cffcd`. Governing source: PRD v1.2, `implementation/platform/spec/prd-v1.2-source.txt` and the matching editable DOCX; workspace source `work/prd_content_v1_2.txt`. Read-only source review only: no new program probes, code changes, deployment or paid activity was performed for this plan.

## 1. Outcome and boundary

The next useful product milestone is a complete, understandable **local collection and member journey** on the existing React client: accurate stages and eligibility, understandable historical entitlements, clear operation progress, accessible mobile interactions, and consistent public deep links. The work should consume authoritative API read models and preserve the existing no-execution capability declaration.

Do not rewrite the app or repeat the foundation. Retain `platform/site/`, the generated client, domain reducers, durable collection ledger, canonical SSR adapter, operator console, preview/demo, and existing tests. Keep Warplets Base, Stonklets, Network, existing Workers and production bindings untouched. Do not merge the old October feature stack.

This product work is useful before custody is selected. A polished collection screen, an API reservation, a signed beacon or a passing browser test does **not** prove that a paid mint, transferable financial entitlement or two-NFT update can execute safely. Financial capability remains false until separately reviewed evidence and authorization exist.

### Safe now versus dependent later

| Work | Useful overnight, before custody resolution | Boundary |
| --- | --- | --- |
| Public collection/Season/NFT screens and disclosure | Yes | Show provenance and uncertainty; no simulated ownership presented as live ownership. |
| Capability-aware navigation, unavailable states, accessibility, responsive design | Yes | Missing routes remain unavailable; no stub success responses. |
| Message sign-in, wallet lifecycle, receipt recovery | Yes | No transaction-sign or send capability added in this track. |
| Whitelist intake, frozen eligibility snapshots, read-only eligibility explanations | Yes, with fixture evidence | Real chain completeness and finality remain a release gate. |
| Season pair selection, probability/expiry previews, local request lifecycle | Yes | Business logic stays on the server; assets are only locally reserved. |
| Fairness transcript and committed outcome replay | Yes, existing offline beacon candidate | Do not select a production provider or claim that a database timestamp is an irrevocable purchase. |
| Metadata schemas, field authority matrix, local refresh proposal workflow | Yes | An accepted local proposal is not an on-chain update. No paid generation or new external provider is required. |
| Paid mint/refund, custody-backed claim, real upgrade/reroll fulfillment | No, not from product work alone | Requires enforceable custody, trusted payment/admission, locks, costs and audited adapters. |
| Live marketplace execution and royalty claims | No | Exact asset standard, plugin policy and venue transactions must pass compatibility review. |
| Physical mobile wallet/deep-link acceptance | Prepare and automate what is possible | Actual device evidence must be supplied by a human/device owner; do not fabricate completion overnight. |

## 2. Preserve these settled policies

The implementation agent should not ask the founder to reconfirm these:

1. Vault → Stake → Earn, Solana first, actual launch activation clocks, and the approved 80/10/5/2.5/2.5 economics. No automatic Base Warplet economic rights.
2. Genesis maximum 10,000, ten tranches of 1,000; Level distribution per tranche is `[489,256,128,64,32,16,8,4,2,1]` for Levels 1–10. Initial tranche weight is 2,013; all Genesis weight is 20,130 from inception.
3. All unminted reserved slots accrue their full share. Mint inherits the original allocation clock: 24-hour cliff, then 24-hour linear vesting. A transfer never resets that clock or restores claimed balances. No second historical-mint lock is the delegated v1.2 default.
4. First Genesis whitelist stage is 0.1 SOL. Each eligible wallet may mint once **per stage**, not once per tranche. Duplicate whitelist entries in a stage do not add capacity. All stages share the tranche's inventory.
5. Monthly default cadence; advisory choices ASAP, 7, 14 and 30 days; 48-hour voting and 48-hour stage notice can overlap. Frozen union of Genesis holders and the next tranche's whitelist, one vote per wallet. Final founder rationale and vote turnout remain distinct. Unsold prior inventory postpones the next tranche by default.
6. Monthly Seasons have up to 1,000 slots, the same initial distribution, and expiry at original Season start plus current Level calendar months, with UTC month-end clamping. Expired assets retain historical claims. The published Season start, not mint/upgrade time, controls duration.
7. Upgrade two distinct same-Season, same-Level, same-owner assets at Levels 1–9. Target rises one Level; material survives and independently rerolls Level from the original distribution. Fee is 0.01 × starting Level SOL. Both visual traits and past allocations remain unchanged.
8. Visual reroll changes Model, Backdrop and Symbol together, never Level. Fee and cooldown are `0.01 × 2^r SOL` and `2^r hours`, counted from completed rerolls; cooldown starts on successful fulfillment. The count survives transfer. Reject unrepresentable quotes rather than cap/reset arithmetic.
9. Season distribution: priority whitelist, expanded whitelist, revealed-Genesis-Level-1 free phase, then optional founder/public stage. The free snapshot freezes ownership and public reveal at the boundary; Season 1X alone never qualifies. One free mint per eligible wallet; creation/network costs still apply. Residual inventory remains unminted by default.
10. No Burn NFT action, ever, in app or public API. This does not establish protection against externally initiated burns.
11. Genesis owner-requested AI reference-image refresh is a required later feature: no arbitrary final image replacement, no Level or claim change, preview approval, cost-plus quote and idempotent fulfillment. Royalty targets are Genesis 5% and Seasons 2%, subject to measured enforcement.
12. The Sydney launch window and later mint prices remain open intentionally. Never replace an unset commercial value with demo values or an inferred approved default.

## 3. What exists, and the concrete gaps

| PRD / acceptance | Current source evidence | Remaining product gap |
| --- | --- | --- |
| §3.2–3.3, A35–A38, A47–A50 | `site/src/routes.tsx`, `session.tsx`, `wallet-adapters.ts`, `public-pages.mjs`, `serve.mjs`; four viewport browser walkthrough; Wallet Standard signature tamper case | Capability discovery is not consumed by `site/src/sdk.ts`. Native dialogs are used; shadcn/ui is not installed. Do not add it merely to match a label—record the minimal primitive choice and test access needs. Physical wallet return flow and broader accessibility acceptance remain open. |
| GENESIS-01–04, A23–A25 | `domain/collections/{policy,inventory,ballot}.mjs`, `governance/ballots.mjs`, `collect/store.mjs`; durable limits/notice/vote/opening holds | Canonical Genesis is mainly static terms plus a link to Collect. It needs actual tranches/stages, phase costs, separate sales counts, eligibility reasons and fairness provenance. Initial quotas exist in the API but are omitted by the site's runtime model. |
| SEASON-01–07, A26–A32 | `domain/collections/progression.mjs`, `collect/store.mjs`, `collect.test.mjs`; free-cut snapshot, immutable history, two-asset lock, replay, counter | Pair selection is a free-text ID with a broad datalist. Asset page lacks exact expiry/active state and reroll details. Quotes omit material-expiry outcome range and a clear warning that material downgrade can reduce total future weight. |
| VAULT-01–06, A06–A10 | `vault/ledger.mjs`, `vault/projection.mjs`; binding from mint and transfer; unrevealed public Vault guard | Combined wallet token totals and per-asset vesting timelines are absent. UI mostly shows base units. Missing/fresh price evidence and net realizable value must not be collapsed into `$0`. |
| A24, A29, A37, A40 | `collect/store.mjs`, `randomness/selection.mjs`, `beacon/`; current public operation projection is only `awaiting-evidence` or `fulfilled` | Users cannot distinguish waiting for earlier admission, entropy, fulfillment or an evidence hold. Local receipt not linked to richer transaction recovery. No selected paid timeout/refund contract. |
| GENESIS-05, A34 | No metadata/refresh service in current `platform/`; Core lab reports authority conflict | Need schema/authority contract and proposal workflow. Cannot assume unrestricted update authority is safe. |
| §10, A33 | `lab/CORE-VAULT.md`, `validation/protocol-status.md` document narrow transfer/claim fixture and incompatible burn/authority cases | No verified marketplace integration or selected production NFT permission configuration. Public detail should state compatibility as unverified; no marketplace branding or trade CTA that suggests integration. |
| §11–12, A35–A36 | `contracts/capabilities.mjs` explicitly inventories Node versus local Worker routes | Worker does not host Node collection writes, full Earn writes, quotes, notifications or operations. Site must degrade per capability rather than assume a healthy `/health` means full parity. |

Evidence reported by the current handoff: Linux checkpoint `cb37697` passed 128 Node tests, four frontend tests, one Worker integration and two beacon tests. These are existing reported results, not new executions in this planning task. Relevant component tests currently render static markup; they do not replace interaction or physical-device testing.

## 4. Build order for an unattended session

Each milestone is independently reviewable and may be committed after its listed checks. Keep new states additive and retain existing clients until contracts are updated. Do not work on two migrations with the same number concurrently; the coordinator assigns the next available migration number. File names below are proposed destinations, not files already present.

### P0 — Baseline and traceability, before implementation

1. Read repository instructions, PRD source, `validation/implementation-status.md`, `validation/protocol-status.md`, `collect/README.md`, `beacon/README.md`, `site/README.md` and current capabilities.
2. Record branch/head and clean versus user-owned changes. Run generated-contract drift check and current narrow product/collection tests once; retain failures separately from new regressions.
3. Create `platform/validation/product-acceptance.md`: each PRD case maps to exact test(s), status `proven-local | missing | gate-dependent | physical-required`, and source commit. Avoid a single misleading completion percentage.
4. Keep an implementation status file with current milestone, changed files, next command, outstanding uncertainty and last passing checks. This is especially useful for unattended compaction/resumption.

Done: all later tickets have an owner, requirement, dependency, test and rollback. Rollback: documentation-only revert; no data or runtime changes.

### P1 — Capability-aware shell and dependable session behavior

**Priority: highest. Independent of custody.**

Existing interface: `GET /api/v1/capabilities`, generated `getCapabilities()`. Consume this rather than invent a second capability registry.

Proposed files: `site/src/capabilities.tsx`, changes to `sdk.ts`, `routes.tsx`, `session.tsx`, `notifications.tsx`, `recovery.tsx`, `collect.tsx`, `earn.tsx`, `quote-panel.tsx`; `site/tests/capabilities.spec.mjs` and browser cases.

Steps:

1. Load capabilities once per API origin/policy revision. Recognize advertised route/method pairs. Render explicit loading, unavailable and unavailable-in-this-runtime states. A failed discovery read disables mutation affordances; public policy text may still render.
2. Node exposes all local fixtures; Worker shows only advertised public/member reads and ballots. Gate collection inventory, asset, eligibility and receipt **reads**, transaction recovery **reads**, and every mutation by its advertised method/path. The current Worker lacks the Node collection-operation and transaction-receipt surfaces, so do not mount those queries or present their empty responses as a user's empty holdings/history. A canonical collection route can still show supported policy information and explain unavailable runtime detail. Quote, local inbox and operator-only surfaces also require their own advertised capabilities. Never use 404 fallback to pretend an unsupported read or mutation succeeded.
3. Preserve source labels at feature and record level (`local-fixture`, `local-rehearsal`, future `verified-observation`). Capability existence and release approval are separate. The present `production.*` false constants remain false.
4. Standard wallet registration/removal already works. Add account-change/disconnect subscriptions where advertised, explicit unsupported-feature handling, and cancellation-safe account switching. Clear outstanding challenge review when the selected signing account changes. An existing server session remains identified as the signed-in account until revoked; never silently relabel it with the extension's new account.
5. Group all wallet-derived query keys under a private principal/chain namespace, including personalized inventory eligibility. Invalidate private cached results on logout/session expiry/account cutover; public SSR must use no cookies or wallet activity queries.
6. Add an explicit return-to-origin status after a user leaves for a wallet application: resume original request/receipt, recheck session/expiry, and do not create a second operation. Do not add speculative wallet-specific mobile links yet.

Tests: Node and Worker capability fixtures; missing/failed/malformed capabilities; unsupported collection and transaction reads as well as writes never fetched; unsupported runtime differs from a supported empty holdings/history result; two wallets and session expiry; account change during sign-in; unregister; cancel; wrong signed-message bytes; dialog keyboard/focus/escape; query state after logout/reload; SSR never includes eligibility or private receipt IDs.

Rollback: revert client changes while retaining current API; no migration. If a capability parser fails, the safe UI is read-only/unavailable, not a fallback execution button.

### P2 — Complete public collection read models and canonical pages

**Depends on P1. No custody dependency for truthful local reads.**

Proposed files: `collect/projections.mjs`, additive `collect/http.mjs`/contract schemas, `site/src/collections/overview.tsx`, `stage-detail.tsx`, `rarity.tsx`, `asset-details.tsx`; refactor `details.tsx` and `collect.tsx` without replacing routes. Add `site/tests/collections.spec.mjs` and expand `browser-qa.mjs`.

Retain existing `/api/v1/collect/inventories`, `/inventories/{id}`, `/assets/{id}` and owner routes. Extend generated response schemas before changing clients. Keep existing canonical links and legacy query URLs working.

Proposed additional read fields:

```text
InventorySummary:
  policyVersion, termsDigest, asOf, source, executable:false
  kind, tranche?, seasonStart?, capacity
  counts: paidStageAllocations, freeStageAllocations, founderStageAllocations,
          pending, unsold, unmintedReserve
  paymentEvidence: {status:'not-applicable-local', verifiedSales:null, realizedRevenue:null}
  initialLevelQuotas[10], publiclyRevealedLevelCounts[10], concealedCount
  currentActiveWeight?: {value, evidenceId, asOf, status}
  stages[] and drawPolicy?: {id, hash, status, scheme, disclosureUrl}

AssetDetail:
  canonicalAssetId, inventoryId, ownerObservation:{owner, slot?, at, status, source}
  reveal:{status, at?, publicVersion?}
  [revealed only] level, traits, seasonStart?, expiresAt?, activityStatus,
                  rerollCount, nextRerollAt?, operationPending
  metadata:{revision, imageManifestHash?, status}
  marketplace:{status:'unverified'|'external-link-verified', venue?, url?, checkedAt?}
```

Only add fields backed by actual local records. Unknown live slot is null, never zero disguised as evidence. Derived expiry and active weight come from domain/server projections, with evidence time. Do not infer on-chain rights from mutable image metadata.

Public Genesis page shows ten-tranche program, actual published tranche/stage inventory, initial rarity table, accrued reserve explanation, first price and later unpublished prices as unset, conditional next-opening notice, ballot link/decision and separate priced-stage/free-stage/founder-stage fixture allocations and reserved counts. In the local adapter, use `paidStageAllocations` for entries classified by a priced stage, not "paid sales," sell-through, verified receipts or revenue. Preserve existing `counts.paid/free/founder` fields as documented compatibility aliases while migrating the generated schema and UI; their presence does not establish payment. Verified paid sales and realized revenue stay unavailable until separately reconciled payment evidence exists. A stage has a stable shareable anchor or nested URL, final terms digest, notice/published time, exact costs/payer and status.

Season page shows original start, all Level expiry dates or a selected-Level view, exact time remaining, initial probabilities versus current revealed counts, published stages/free-snapshot state and permanent historical-claim explanation. NFT page shows owner evidence age, Level, exact active/expired status, remaining claims and image/reveal provenance; no visual placeholder described as an actual generated asset.

Concealment rule: do not reveal an unrevealed asset's Level through JSON, HTML, OG images, per-asset Vault amounts, reserved-slot coordinates, operation receipts or aggregate differencing. Show counts of publicly revealed Levels plus a concealed count; publish final current counts after the appropriate reveal. Never expose an operator's pre-reveal inventory-to-asset mapping in a public transcript. This is a data-projection obligation, not just CSS hiding.

Tests: empty inventories, 1,000 capacity, multiple stages sharing slots, full/closed/postponed/awaiting-snapshot states, two-page pagination and back navigation, year/month-end expiry, late/expired mint, missing owner evidence, hidden metadata through all public projections, truthful real 404/503 and canonical HTML, no wallet data in shared metadata. A fulfilled priced-stage fixture must increase only its allocation count; it must not create a verified sale, received-payment status, revenue value or "paid" receipt.

Rollback: response additions remain optional; old viewer still works. Use additive views/tables only when projection cannot be derived cheaply. Do not rewrite committed inventory or launch snapshots to repair presentation.

### P3 — Eligibility and curated whitelist workflow

**Depends on P2; usable offline before a real indexing provider exists.**

Proposed files: `collect/eligibility.mjs`, `collect/whitelist-import.mjs`, `collect/operator.mjs` extensions, `collect/eligibility.test.mjs`, `site/src/collections/eligibility.tsx`. Operator UI intake can follow only behind the existing separate operator boundary.

Steps:

1. Introduce operator-only dry-run intake for curated lists. Validate canonical Solana addresses, deduplicate deterministically, cap size, name the stage/source and display entry/duplicate/error counts. A Base Warplet community invitation is a curated eligibility source, not a bridge or a token claim.
2. Final publication seals stage terms and eligibility digest. A corrected draft may be edited before publication; a published stage cannot silently replace prices or lists. Changed future stage terms become a new version/stage with required notice.
3. Extend the owner's eligibility read with a bounded reason enum rather than one boolean. Proposed `GET /collect/inventories/{id}/stages/{stage}/eligibility` uses the session wallet only; it does not accept an arbitrary wallet query or return the complete whitelist.
4. Proposed response: `{eligible:boolean|null, reason, snapshotId, termsDigest, walletLimit, used, remaining, stageStatus, asOf, source, executable:false}`. Reasons include `not_signed_in`, `not_on_list`, `snapshot_pending`, `snapshot_incomplete`, `eligible`, `wallet_limit`, `sold_out`, `stage_closed`, `opening_hold`. Null represents unknown/pending; it is not rejection.
5. For a Season free phase, retain `freezeSeasonSnapshot`: the immutable logical snapshot cut is **always the published `stage.opensAt`**, even if evidence arrives or is accepted later. First acceptance fixes the complete evidence **for that predetermined cut**; it never selects a new cut or uses the acceptance/first-mint time. Prove the adapter supplies collection identity, the finalized slot/block-time anchor corresponding to the cut, reveal/owner observation references at the cut, expected inventory coverage, digest and explicit completeness state. A partial page from an indexer must not be treated as the full eligible set. Contradictory evidence holds new work for review, never rewrites a completed sale or moves the snapshot forward.
6. Build an operator preview of eligible count, unknown/late-reveal count and conflicts before freezing. No free reservation is accepted while the snapshot is pending/incomplete. Post-snapshot owner transfers do not add a second free mint.

Tests: duplicate stage entries; one wallet eligible in two stages; frozen union ballot; two wallets racing last slot; Genesis newest tranche unrevealed then revealed before cutoff; Season-only Level1; transferred after cutoff; conflicting local history; missing index pages; canonical complete-cut replay; unauthorized snapshot publication. Evidence accepted hours after opening must still use ownership/reveal at `stage.opensAt`; a late reveal/transfer cannot qualify by shifting the cut, and first acceptance cannot substitute its own timestamp.

Rollback: disable new intake/publication, retain published terms/snapshots and existing operation receipts. Never invalidate already accepted wallets by replacing a historical list.

### P4 — Honest operation timeline and recovery contract

**Depends on P1–P3; exact financial state transitions are adapter-dependent.**

Current `collect/store.mjs` exposes only `awaiting-evidence` and `fulfilled`. Add an append-only diagnostic/event projection, not fabricated payment phases. Proposed files: `collect/operation-events.mjs`, additive `storage/NNN-collection-events.sql`, `site/src/collections/operation-timeline.tsx`, `site/src/recovery.tsx`, integration tests.

Proposed state model separates three independent facts:

```text
requestState: admitted | held | fulfilled | failed-terminal
evidenceState: not-required | awaiting-earlier-admission | awaiting-entropy |
               awaiting-fulfillment | incomplete | verified
financialState: not-applicable-local | unpaid | committed | outcome-unknown |
                finalized | refund-pending | refunded
```

In the local adapter, `financialState` is always `not-applicable-local`; never show "paid" based on a quoted lamport string. Only a reviewed payment/chain adapter may enter financial states later. Keep compatibility `status` until clients migrate. Internal events retain operation ID, monotonic revision, exact timestamp, reason code and evidence references. Before the authorized reveal, receipts and public projections expose only an opaque public commitment plus non-sensitive status: withhold outcome-reconstructing salt, context, proof, round, admission order and their reconstructable combinations, including from the owner-facing receipt. Coarsen or omit timing/reference fields if the published scheme would otherwise derive the withheld information. Release the verifiable transcript only under the reveal policy after the assignment is irreversible; access controls alone are not a concealment guarantee.

Steps: link pending collection request to its exact original idempotency key and any later typed transaction intent; retain one business operation across uncertain responses; show "Refresh status" and evidence/next-safe-action text; distinguish a user-rejected signature from unknown network outcome; on reload, recover original operation instead of creating a new request. Maintain complete locked target/material descriptions for progression.

Do not implement automatic reservation cancellation/refund for a paid mint while timeout semantics are unresolved. A timeout must not let a participant observe a rare/common outcome, cancel selectively and obtain a new draw. Do not release a local asset lock merely because browser time expired. The production timeout/refund design is a custody/fairness dependency, not a UX default.

Tests: repeated identical idempotency request after lost response; changed body conflict; queue order; expired display clock with operation still held; retry keeps commitment and result; application restart; partial evidence rejected without mutation; two-tab duplicate; session expiry retains recoverable server state; all private history remains owner-scoped; pre-reveal public and owner receipts cannot reconstruct the outcome from combined context/round/proof/order/timing fields. Existing transaction unknown/confirmed/finalized semantics must remain distinct.

Rollback: stop admitting new requests with the scoped feature control; retain receipt/history reads and recovery. Roll back new display/event writers only after preserving event rows. Never delete a pending operation as rollback.

### P5 — Season collection studio as a complete vertical feature

**Depends on P2–P4. Local operation rehearsal is independently useful.**

Proposed files: split `site/src/collect.tsx` into `collections/asset-picker.tsx`, `progression-review.tsx`, `operation-timeline.tsx`; enrich `collect/store.mjs::quoteProgression` or a dedicated projection module; contract/client schema regeneration; browser journey fixtures.

Steps:

1. Select a target from owned, revealed assets. Query a bounded owner-scoped eligible-material list by collection/Level/target/version; do not require knowledge of an opaque asset ID or assume the first page contains every valid pair. Keep a manually entered ID only as an optional advanced path with server validation.
2. Show the two assets together: current Levels, Season start, exact current expiries, historical Vault balances and locks. Disable invalid pairs with a reason. Refresh quote after ownership/version change; final admission rechecks both and the exact reviewed quote atomically.
3. Proposed quote fields: `quoteId`, `bindingDigest`, `policyVersion`, `asOf`, `expiresAt`, `targetVersion`, `materialVersion`, `feeLamports`, `maxTotalLamports`, `costQuote:{status, items, payer}`, `targetAfter:{level,expiresAt}`, `materialOutcomes:[{level,probabilityNumerator,probabilityDenominator,expiresAt,activeAtQuote}]`, `historicalAllocationsChange:false`, `visualTraitsChange:false`. Bind the quote to principal, operation kind, collection, both asset identities/versions, economic policy, exact fee and disclosed total-cost ceiling, expiry and expected outcomes. Reuse server arithmetic; never calculate the economic result from UI strings. An unknown real cost remains unknown and cannot yield a financially executable quote.
   The progression command must carry `quoteId`, `bindingDigest`, expected asset versions, the reviewed fee/total-cost ceiling and quote expiry alongside its idempotency key. In one atomic admission transition, verify those values against the immutable stored quote, its bound principal/action, current asset ownership/versions, server time, costs and scope status before reserving both assets. Do not merely fetch a fresh quote inside the click handler and accept changed terms without review. A subsequent cost above the approved ceiling requires a hold and fresh approval, never an increased charge. **Resolve an existing accepted idempotency replay first:** identical accepted commands return the original receipt even after quote expiry or a new pause; changed-body replays conflict. Only a new admission must satisfy the current quote/expiry predicates. The local adapter still makes no financial charge.
4. Explain that the material can downgrade and lose remaining benefit time even while the target improves. Show current benefit time and all possible expiry outcomes, including reactivation of an expired NFT. Do not imply guaranteed increase in total benefit.
5. Reroll review shows exact completed count, current cooldown end, next fee, next cooldown from successful fulfillment, all three affected fields and unchanged Level/history. No preview/keep mechanic or paid cooldown bypass.
6. Render successful local outcomes with both affected assets, previous/new versions and unchanged historical snapshots. A pending request leaves both reserved; unavailable operation states show the server reason.

Tests: same NFT twice, cross-Season, different owner, unequal Level, Level10, hidden Level, transferred after quote, asset locked by concurrent request, exact start/expiry/month-end cases, material downgrade/reactivation, reroll beyond representable arithmetic, completion-time cooldown, transfer retains counter and original Season start, old Vault manifests byte-identical before/after. New commands with expired, altered, wrong-owner or mismatched-asset quotes fail atomically; concurrent quote consumption cannot create duplicate reservations; identical accepted replay after expiry/pause returns the original receipt; changed-body replay conflicts; increased fees/cost ceilings cannot be substituted without a fresh reviewed quote.

Rollback: retain receipts and asset history; disable new progression. Do not reverse a fulfilled Level change in place or reset a reroll counter; any correction must follow a separately specified policy.

### P6 — Metadata permission contract and local image-refresh proposal

**Depends on P2/P4. Schema and rehearsal can proceed; actual Core configuration cannot be selected from current evidence.**

Proposed files: `nfts/metadata-schema.mjs`, `nfts/permissions.mjs`, `nfts/refresh-workflow.mjs`, matching tests, optional additive local SQL; `site/src/collections/image-refresh.tsx`. The new `nfts/` domain must reference collection identity and versions rather than duplicate inventory or ownership ledgers.

Authority matrix to make executable in local validation:

| Field | Genesis | Season | Authorized transition |
| --- | --- | --- | --- |
| Canonical asset/collection/reserved-slot identity | Immutable | Immutable | Initial verified binding only. |
| Level | Immutable | Progression-controlled | Only an accepted atomic two-NFT upgrade/material draw for Seasons. Never an image update. |
| Season start | Not applicable | Immutable | Published collection creation only. |
| Expiry | Not applicable | Derived from start and Level | Domain calculation; not owner-supplied metadata. |
| Past allocation/claimed records | Immutable history/append-only claims | Same | Custody authority and finalized claim evidence; never metadata authority. |
| Reroll count/cooldown | Not applicable to Genesis image refresh | Persistent | Successful visual reroll only; survives transfer. |
| Model/Backdrop/Symbol | Artwork schema to specify | Visual-reroll controlled | Do not let generic refresh alter financial fields or silently replace Season trait mechanics. |
| Display image URI/hash/provenance | Approved owner refresh | Initial art / approved visual reroll | Scoped media revision, with previous revisions retained. |
| Royalties | Target 5% | Target 2% | Collection configuration subject to actual program/venue support. |

Local workflow: `draft → reference-validated → moderation-pending → preview-ready → owner-approved → fulfillment-pending → fulfilled`, with explicit `rejected`, `generation-failed`, `owner-changed`, `cancelled-before-commit`. Add financial status separately as in P4; an offline provider must be labeled as an artifact fixture and cannot claim to generate an AI image. A reference upload is input, never an arbitrary final replacement. Bind owner approval to asset/version, preview hash and exact quote; changing any requires fresh approval. Recheck current ownership before any eventual paid fulfillment. Preserve request idempotency, provider job identity, output provenance and every old image revision.

Do not subscribe to a provider, generate bulk assets or debit SOL during overnight work. A usable first slice can display the proposal, validate uploaded fixture/reference metadata, accept/reject a local preview and show pending gated fulfillment. Keep paid AI controls disabled until selected provider costs, legal/moderation requirements and refund terms are approved.

Critical dependency: current Core experiments show ordinary asset burns strand signer claims; a burn veto can be removed by asset update authority; the experimental unreachable authority constrains needed metadata changes; a permanent burn delegate can bypass the veto. Therefore no PR should enable an unrestricted update authority, burn plugin combination or claim-safe label as a shortcut. Record the required permission contract for the protocol workstream to satisfy. If it cannot, present a concrete reviewed alternative and cost before production selection.

Tests: image-only update cannot change Level/slot/start/claim data; old owner cannot approve after transfer; preview mismatch; duplicate fulfillment; failed provider retry retains operation; unauthorized operator overwrite; malformed references are rejected; no image result reported before a real fixture artifact exists. These local tests validate app boundaries, not the on-chain permission composition.

Rollback: disable new refresh requests/fulfillment, retain historical media manifests. A prior image may be restored only by a separately authorized new revision; never erase provenance or touch financial attributes.

### P7 — Fairness transparency and operator publication rehearsal

**Depends on P3–P4. No new protocol or security probes in this product track.**

Use existing `randomness/selection.mjs` and `beacon/` candidate. Do not replace it with `Math.random`, a predictable published permutation, an operator-chosen ticket or an unverified entropy string.

Proposed read interface: `GET /collect/inventories/{id}/fairness` returns public policy hash, initial quota commitment, commitment-scheme description and known limitations. Before reveal, the individual outcome surface is **public commitment only** plus non-sensitive status; withhold outcome-reconstructing salt/context/proof/round/order and derivable combinations from public and owner receipts. Generic scheme/chain/delay details may be published only where they cannot reconstruct a pending assignment from other exposed data. After authorized reveal and irreversible assignment, publish the appropriate proof/transcript and verification instructions. Production provider status stays `candidate-unselected` unless separately approved. Public transcript publication must never expose future slot/Level mappings or private signer material. This delayed-transcript interface remains useful with recorded offline evidence and does not select a production provider or custody mechanism.

Operator publication packet combines immutable stage terms, list/snapshot digest, price/cost/payer terms, reveal conditions, fairness commitment, capacity and founder decision/notice dependencies. Build a local preview/export through existing operator CLI; if a browser publishing screen is added, use the separate operator auth boundary and existing audit/version controls, never an owner wallet session.

Prepare a real-implementation contract for the owning custody/randomness workstream: payment commitment and admission order must become irreversible before entropy; exact future-round selection cannot be backdated; fulfillment cannot be withheld selectively; a retry cannot choose a new result; free/founder/paid users consume the same finite inventory; unknown or failed outcomes have a disclosed recovery that does not enable redraw. These are unresolved adapter obligations, not assurances supplied by a signed beacon alone.

Tests: frozen list/terms export roundtrip, post-reveal transcript hash reconstruction, correct proof visibility, same-result replay, earlier-admission hold, manual ticket path rejected for protected inventory, no pre-reveal inference through public or owner responses even when combining operation timestamps, policy parameters and identifiers. Retain existing real captured beacon signature fixture tests; no fresh network enrollment is needed.

Rollback: pause new admissions/publication; retain old terms, transcript, accepted commitments and same-round recovery. Do not change the beacon chain or inventory mapping of an in-flight operation.

### P8 — Product acceptance pass and approval-ready handoff

**Depends on completed usable slices above.**

1. Run from a newly seeded in-memory demo and separately from an empty database. A polished empty state is required; populated fixtures must never be mistaken for a live launch.
2. Walk these complete journeys at 360/390/768/1440px: anonymous market→collection→stage; message sign-in→eligibility→one local reservation→reload receipt; Genesis vote→decision display; owned Season pair→quote→pending→fixture fulfillment→both assets; image proposal→owner preview approval→gated fulfillment; Vault history after transfer; logout/private-cache removal.
3. Keyboard-only acceptance: skip link, route focus, all menus/dialogs, material selection, probability disclosure, table/mobile access, error summary, focus after close/back, quote expiry/receipt updates announced once. Check contrast, 200% text and 400% zoom/reflow, reduced motion, long addresses/translated-length text, touch target dimensions and no horizontal page overflow.
4. Build a physical-device test sheet with exact wallet/browser/version/device, connection method, permission prompt, account switch, rejection, background/return, expired challenge, offline resume, deep link and signature confirmation. Mark all unperformed cases `not tested`. Do not use an emulator screenshot as a physical test result.
5. Inspect SSR initial content, response codes and privacy for every new deep link; preserve canonical links and share fallbacks. Keep local noindex and restrictive frame policy. Optional Farcaster host integration is deferred unless explicitly needed; host hints must never replace wallet proof.
6. Capture representative screenshots after the UI is stable and record visual approval as pending until founder review. Measure initial/chunk sizes and avoid adding a large component library without a concrete accessibility benefit. Use current pinned stack unless a proved compatibility issue requires a targeted change.
7. Hand off exact commands/results/source commit, screenshots, public/member/operator route matrix, open evidence gates, recurring cost delta (expected zero for this track), and next useful milestone. No production-ready label and no automatic release PR merge/deployment.

Rollback: revert individual client commits or route feature switches; keep old compatible APIs and durable event/receipt data. Always preserve read/recovery access when new actions are disabled.

## 5. Cross-track dependencies and interfaces

| Dependency owner | Product work requests | What product may do while waiting |
| --- | --- | --- |
| Custody / protocol | An enforceable asset/collection permission specification compatible with current-owner claims, external transfer, burn policy, metadata refresh and atomic Season progression; exact limitations/costs | Permission matrix, proposals, status reasons, local fixtures and read-only historical views. |
| Real read adapters | Canonical chain/asset/collection IDs; finalized observed slot/time; coverage/completeness; current owner/reveal; token decimals; coherent historical cutoff | Render null/pending with reasons; test recorded snapshots without labeling them live. |
| API / hosted adapter | Node–Worker route capability parity, owner-scoped queries, atomic conditional inventory writes, audit/idempotency semantics | Gate components by actual capabilities; finish reference API/UI integration. Do not move aggregate SQLite JSON writes to D1 unchanged. |
| Economics / quotes | Exact-unit token formatting metadata, server-computed projections, evidence age/status, effective quote cost | Share existing amount utilities and display known values. No total USD wealth based on stale or absent price data. |
| Earn | Highest eligible NFT component with reveal/expiry provenance, action list/completion evidence, component-pending reasons | Show server-derived component explanations; never recompute multiplier eligibility in React. |
| Operations | Approved immutable stage terms, spent/reserved costs, status controls, staffing and audit versions | Export concrete review packet and display scoped hold reasons; no broad "pause all" claim over external chain methods. |
| Marketplace / external provider | Verified venue+asset-standard matrix, actual list/buy/cancel/private-transfer/royalty behavior; owner evidence after sale | Asset display and adapter interface only. External links stay unavailable until verified; no assumed OpenSea support. |

Stage prices and source snapshots belong to backend contracts. Native SOL formatting belongs to display utilities. Fee decay, Level transitions, eligibility, active weight, expiry, Vesting and random selection must not be duplicated in the frontend.

## 6. Founder gates versus delegated implementation choices

### Leave open without blocking the local build

- Sydney launch window and later mint prices. Show unset; accept published terms later. No question is needed merely to build configuration/read views.
- Initial configurable onboarding actions. Build verified-action framework and examples labeled draft, not fake follow completions.
- Visual polish and approved art. Use truthful neutral placeholder/fixture media and prepare screenshots for review.

### Engineering can decide and record

- Component split, accessible native primitives, API field naming, query keys, paging, error copy, test fixtures and snapshot export format.
- Read model denormalization after measurement, additive migrations, opaque cursor strategy and local operation timeline.
- Offline candidate-verification presentation and pre-custody metadata proposal schema.
- A conservative unknown/unsupported state whenever reliable data is absent. This is not a new economic policy.

### Return a concrete choice when the relevant release is approached

- A permission/custody design that cannot satisfy permanent claims, no-burn product policy and required metadata changes without new funded engineering/review. Present measured options and tradeoffs; do not ask the founder to bless an unexplained plugin setting.
- Paid-sale timeout/refund and selective-withholding recovery when choosing the actual payment/randomness mechanism. Needs concrete state machine, cost and user outcomes; no discretionary operator redraw.
- Exact randomness provider enrollment and dependency/cost terms; marketplace/wallet support set after evidence, not by logo preference.
- Any public Genesis stage, founder inventory/backstop spend, later sale price, or paid AI/provider service. Present exact publishable terms and quote. Existing 0.1 SOL first whitelist stage does not approve all later sales.
- Financial or public deployment, funded canary and applicable legal review. Neither a feature-complete UI nor this plan authorizes them.

The product agent should not repeatedly ask about settled economics or request broad “approve everything” confirmation. If an evidence-dependent branch blocks one milestone, continue the independent local work and leave a precise blocked item.

## 7. Recommended overnight allocation and stop conditions

Use a single product/collections owner to avoid overlapping contracts and UI edits; coordinate additive response changes with the API owner. Recommended order: **P0 → P1 → P2 → P3 → P4 → P5 → P8**. P6 and P7 are smaller independent follow-ons only after the core collection journey is stable. Prefer one fully usable vertical slice over many unfinished forms.

At each milestone: inspect diff, run targeted domain/API/component/browser checks, preserve machine-readable evidence, commit the completed scope and push if the overall task authorizes it. Run the broader current suite once at the final integration boundary; repeat it only after new changes or failures warrant it. Never count SDK vectors nested in one test as separate suite tests.

Stop a dependent mutation implementation when it needs real payment, trusted admission, external owner proofs, irreversible NFT authority configuration or a selected custody program. Keep quote/read/receipt flows functional and document the missing gate. Stop broad refactoring when it threatens already proven local behavior. A failed capability or stale observation must produce an unavailable state, not a financial fallback.

Success for this track is a coherent, reviewable product implementation with accurate policy, strong local acceptance and clear remaining gates—not a promise of financial readiness.
