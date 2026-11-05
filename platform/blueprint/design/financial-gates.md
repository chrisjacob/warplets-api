# 10X.MEME financial implementation blueprint

**Execution mapping:** M1/M2/M3/M4/M6 → B19; M5 → B14; M7 → B16; M8 → B08/B19/B20. Unsigned intent integration is B15. Decision records are inputs to R gates, not release approval. Read [CONTRACTS](../CONTRACTS.md), the relevant [task manifest](../tasks.json) and B card first. IDs in this appendix are detail sections, not an independent queue. Proposed paths/numbered migrations are illustrative; the coordinator owns final assignment. All B acceptance is local, with no remote resource mutation, funded execution or new authority probes.

Prepared 5 November 2026 from checkout `5f3caff` on `work/10x-prd-foundation`. This is a specification for the next unattended implementation run, not a financial-release approval. Governing product source: PRD v1.2, particularly LAUNCH-01–06, VAULT-01–06, STAKE-01–03, EARN-01–08, GENESIS-01–06, SEASON-01–04 and gates G1–G6. Exact source files are indexed at the end.

**Next-run objective:** make the existing local financial models independently exportable, reconcilable and ready for an explicit protocol-selection review. Keep every production financial capability disabled. Implement data contracts, ordinary deterministic tests, recovery exports and operator reports. Do not add or execute authority/security probes, send chain transactions, deploy, buy services, generate custody keys or treat a green test as authority to handle money.

The Sydney staffed launch window and later mint prices remain open deliberately. They do not block the work below. The first Genesis whitelist stage remains 0.1 SOL. Do not replace later unknown prices with demo prices.

## 1. Baseline and the actual critical path

The current platform already has exact integer allocation and vesting, an atomic local campaign registry, Vault and farm fixture projections, global Earn settlement, collection reservation/progression reducers, quote math, a fourteen-scenario cost calculator, transaction recovery fixtures and disabled financial capability declarations. Reuse these components; do not build another economic model.

Existing protocol evidence is stronger than the original PRD feasibility observations, but remains incomplete:

| Area | Existing evidence | What the next implementation may rely on |
| --- | --- | --- |
| Meteora | The preserved binary ran the new allocation, opening fee schedule, locked liquidity and both swap directions. A dated November observation matched the preserved binary digest. | Reuse byte layouts and arithmetic as pinned evidence. Do not claim reviewed-source parity, current fee rights or a production market has been established. |
| Kamino | Whole-rate same-token lifecycle reconciled 864,000,000,000 funded units into 777,600,000,000 earned and 86,400,000,000 idle. Harvest, immediate withdrawal/re-stake and end recovery worked in the fixture. | Model that tested configuration and its limitations. The existing administrator counterexample prevents permissionless financial release with an unrestricted farm administrator. |
| Rewards | The fixture proved zero at the 24-hour cliff, partial vesting and a remaining claim at day 800. Direct wallet-bound awards do not follow NFT transfers. | Continue wallet-bound Earn proof design. Do not label its generic Merkle wallet binding a Vault. |
| Core + Rewards | A stable Core asset-signer claimant retained an unminted allocation, paid 30 to the first owner and 70 to a buyer, rejecting the former owner. | Treat it as the leading composition to evaluate. Reserved identity assignment, durable proofs, external burns, metadata/progression compatibility and costs remain unresolved. |
| Quotes | Pinned SDK 1.5.1 vectors match integer outputs, fees and price movement. Unsupported-pool admission and regressed-slot handling are now implemented. | Reuse local math and fail-closed source states. Authentic oracle/finality evidence and exact pre-swap program-state quote parity remain absent. |

The evidence record documents successful runs `42006472697` and `42014527352` and their compatibility limits. The supported-calendar overflow reported in the first review is fixed. The older-finalized-slot quote regression is fixed. Neither should be reintroduced as an unfinished bug. Sources: S2–S7, S12.

The critical dependency order is **economic commitment format → durable proof/recovery → reserved assignment and NFT policy decision → constrained farm-administration decision → trusted observation adapters → complete cash quote → separately authorized financial release**. UI polish does not remove any dependency.

## 2. Non-negotiable domain invariants

All token values are canonical decimal base-unit strings at boundaries and checked integers internally. Use u64 limits where a token amount must fit SPL state. Times bind to actual chain activation `T`, with explicit whole-second or millisecond conversion. Never determine authoritative rewards from browser time.

### Allocation, vesting and snapshots

1. For original supply `S`, `LP + Earn + Stake + Genesis + Seasons = S`. The implemented exact-supply policy requires positive `S` divisible by 200; `LP=4S/5`, `Earn=S/10`, `Stake=S/20`, and normally each Vault gets `S/40`. Ten Earn budgets each equal `S/100`. A nondivisible supply needs a separately published rounding policy, not silent truncation.
2. If launch-snapshot active Season weight is zero, `Genesis=S/20` and `Seasons=0`. The snapshot is immutable. A later Season cannot take any of this past Genesis fallback.
3. Genesis total weight is permanently 20,130 across 10,000 reserved positions. For an ordered slot with prefix weight `p` and Level `L`, allocation is `floor(B(p+L)/20130) − floor(Bp/20130)`. This telescoping scheme assigns exactly `B`, including unminted slots. Allocation depends on reserve coordinates, never mint order or buyer-selected rarity.
4. Each Season launch snapshot records every reserved position and the effective Level at `T`; active weight is zero when `T` precedes start or reaches expiry. Later minting, Level changes, transfer and expiry cannot rewrite that snapshot or its allocation.
5. For allocation `A`, `vested(t)=floor(A × clamp(t−T−86400,0,86400)/86400)`. Claims satisfy `0 ≤ cumulativeClaimed ≤ vested ≤ A`. Claim deltas are cumulative differences, not separately rounded accrual intervals. Minting and transfer preserve `T` and `cumulativeClaimed`.
6. A launch's Vault liability is the sum of `allocation − cumulativeClaimed` across **all** reserved and bound slots. Minting moves a liability's identity; it does not create or destroy it. Known allocated balances are excluded from company inventory, idle recovery and burn budgets indefinitely.
7. Claim authority is the current on-chain NFT owner under the selected program's verified ownership path, never the application session or cached owner. After Alice claims 30 of 100 and transfers to Bob, only Bob can claim the remaining 70. This is an on-chain custody requirement even if the UI is unavailable.

### Farm, Earn and collection effects

8. Stake issuance runs over `[T,T+864000]`. Idle intervals generate no later depositor windfall. `funded = earnedGross + idleWholeUnits + unissuedWholeUnits + roundingReserve`; any unsettled fractions remain backed. Principal is separate from reward liabilities. Ending emissions cannot stop principal withdrawal.
9. Recovery may remove only demonstrated unused emission after preserving all earned but unclaimed rewards and all principal. An administrator's ability to relabel or withdraw principal is incompatible with the intended permissionless Stake experience. A currently empty authority field is insufficient if it can be changed.
10. Gross Stake funding is always exactly 5%. If a selected third party charges a fee, `userNet + thirdPartyFee = harvestedGross`, with the exact rounding method and payer disclosed. There is no authorized top-up from LP, Earn or Vault.
11. For each finalized Earn token/day, `sum(walletAwards)+burn=dailyBudget`; each wallet receives at most 10% of that budget. Missing evidence stays pending, not empty. Final scoring and eligibility are not reopened. Awarded balances remain claimable after campaign closure.
12. Preserve the currently implemented global UTC board mapping as a versioned engineering policy: first allocation uses the board immediately preceding the UTC date containing actual `T`; allocation `d` vests from `T+d days` to `T+(d+1) days`. Day ten therefore finishes vesting on day eleven while Stake emissions finish on day ten. PRD labels this board/window mapping a proposal; publish/confirm the policy before financial use, without inventing a fixed Sydney launch hour.
13. Genesis Level is immutable. Season expiry is `SeasonStart + currentLevel calendar months` in UTC with month-end clamping; upgrades do not restart the start date. Both NFTs survive an upgrade. Both preserve historical balances. Visual rerolls/Genesis PFP refreshes never change financial rights.
14. Mint fulfillment is exactly once per paid commitment; retries retain the same committed result or follow the disclosed refund rule. No operator or buyer may choose a rare historical reserve, reorder a draw after observing entropy, or obtain a free redraw by aborting fulfillment. Founder mints use the same fair assignment constraints.

### Evidence, cash and execution

15. Any value used for a quote or $10 eligibility check binds exact ATT/OG mints, mint decimals, approved pool/feed, original supply, source slot and source publication/observation times. A fresh retrieval timestamp cannot freshen an old oracle publication. Newer invalid/regressed observations hold the decision; they cannot fall back silently to an older favorable value.
16. Cost completeness is distinct from a priced subtotal. Every nonzero account/fee/usage line has a count, payer, denomination, source, freshness and exact execution-context binding. Upfront refundable rent remains a cash requirement. Expenses round up and receipts round down on USD conversion. Token FDV and unsold inventory never count as available cash.
17. A business operation has one immutable intent and ordered attempts. Unknown submission outcomes allow reconciliation only. Replacing an expired, never-submitted message requires a fresh bound packet and review. Neither retry nor restoration may duplicate a payout, mint, funding action or burn.
18. Every unattended deliverable stays `local-validation`, `executable:false`. No runtime may infer production permission from a completed evidence record. Preserve disabled signing, deposits, broadcast and claim execution in the capabilities contract.

Sources: S1 §§4–9, 13–18; S3–S5, S8, S10, S13–S15.

## 3. Prioritized next-run implementation packages

These packages are executable software/documentation work without chain operations. The paths below are proposed additions or extensions within `platform/`; they are not instructions to deploy or to modify the preserved protocol experiments. Shared schema changes should be coordinated through one migration owner.

| Order | Package and scope | Concrete acceptance evidence |
| --- | --- | --- |
| P0 / M1 | **Versioned financial evidence index.** Add `validation/gates.mjs` and a schema/report CLI; use current S2 as an input, not as executable permission. Each gate names requirement IDs, evidence kind, source commit, file digest, network, program/configuration hashes, observed slot/time, limitations and review state. Statuses should distinguish `missing`, `fixture-proven`, `review-required`, `failed`, `accepted-for-named-scope`, `expired`. | A generated read-only report never converts the Kamino principal finding or unresolved NFT burn policy into a pass. Missing provenance, mismatched hashes and outdated observations remain visible. An existing successful CI run qualifies only its named fixture scope. Runtime capabilities remain unchanged. |
| P0 / M2 | **Portable Vault commitment/export format.** Extend `vault/` with a canonical manifest, verifier and recovery importer. Include the launch allocation manifest, all reserved coordinates/weights, Season snapshot digest, slot-to-asset binding evidence, cumulative observed claims and separately identified ownership observations. Export public allocation data without sessions or private moderator records. | Export, independently pin digest, restore into an empty local DB and reproduce exact entitlements before mint, at hour 36, after transfer and after Season expiry. Sum all reserved/bound liabilities before and after restore. Reject changed budget, duplicate binding, conflicting cumulative claims and incompatible policy version. Failure is explicit; no silent repair from current mutable metadata. |
| P0 / M3 | **Program-specific claim artifact specification.** Add pure, offline codecs/fixtures for the selected Rewards leaf and Core claimant context, reusing pinned inspected ABI evidence only. Clearly separate the existing SHA-256 public archive scheme from the Rewards program-specific Merkle scheme. Generate a `ClaimBundle` and independently verify its bytes without preparing or submitting transactions. | A checked artifact identifies distribution address, ATT mint, program version/hash, claimant type, amount, complete vesting parameters, clawback/revocation policy, proof format/root and provenance. A wallet Earn claim and asset-signer Vault claim cannot be interchanged. Golden bytes match already captured vectors; absence of an applicable captured vector stays `missing`. Do not invent new success evidence. |
| P0 / M4 | **Reserve identity and mutation decision packet.** Specify `ReserveAssetCommitment`, `MintDrawCommitment`, `AssetPolicyManifest` and a state-transition table. Connect collection fixture operation IDs to Vault reserve IDs and exports without selecting a real entropy or custody provider. Produce the decision records in §4. | A finite 1,000-slot tranche model consumes exact quotas, retains assigned results across retries, handles pending reveal and preserves all historical claims through transfers/progression. Every unresolved identity/signing/authority fact is an explicit field, not a boolean supplied by an HTTP client. Existing tests stay local and deterministic. |
| P1 / M5 | **Shared pricing provenance envelope.** Unify semantic field definitions between `quotes/` and `pricing/` without merging their distinct consumer policies. Separate account-context slot, observation time, oracle publication time/slot, price confidence, program hash, source policy version and investigation status. Implement fixture import/export and validation only. | Both consumers reject wrong mint orientation, stale oracle publication, higher retrieval time with regressed finality, conflicting same-slot bytes, and unknown source. Quote-only observations cannot silently count as a complete Earn stake checkpoint. Quotes expire at the earliest source expiry, 15-second lifetime or next decay second. Existing latest-invalid masking is retained. |
| P1 / M6 | **Farm lifecycle/authority planning contract.** Add a typed, read-only `FarmPlan` and `FarmReconciliation` report around existing domain and farm fixtures. Specify every permission needed at initialization, funded operation, campaign end and claims-only operation. Implement accounting checks and a report; do not implement an authority controller. | A report reconciles principal, funded rewards, gross earned claims, harvested fee/net amounts, idle/unissued/rounding and recovery eligibility. An unrestricted administrator is always `review-required/failed` for financial release even if its current withdraw field is empty. Whole-rate evidence does not certify arbitrary precision schedules. |
| P1 / M7 | **Operation-level cash packet and comparison UI.** Connect the existing fourteen-scenario calculator to named candidate plans and evidence-index IDs. Add peak upfront cash, consumed cost and expected refundable capital as distinct outputs; preserve all unknowns. Produce a first-ATT/one-claim/one-mint comparison and zero-demand month report. | A candidate cannot appear affordable with missing claim-state rent, random fulfillment, network fees, FX or retries. Disjoint account roles are counted once; reuse must have evidence. Missing claimant expenses remain visible even if founder cost is known. A $12 pilot is review, a $31 pilot is over ceiling, and the 50% reserve remains advisory. |
| P2 / M8 | **Nonfinancial recovery integration.** Connect campaign registry, collection bindings, public Earn archive, Vault export, farm reconciliation and cost references using one operation/evidence ID vocabulary. Add a read-only operator checklist showing missing evidence by release stage. | A disposable local scenario restores accepted commitments and claims after DB loss, preserves unknown transaction state, and never re-awards a claim or chooses a new draw. Output differentiates readiness to publish a preview from readiness for a funded release. |

Commit/push normal code/documentation milestones only according to the coordinating run's instructions. Keep each milestone reviewable and record exact local tests and limits. Do not spend the night rewriting already-verified arithmetic or broadening tests without an uncovered invariant. Do not modify lab replays or trigger new authority experiments as part of these packages.

## 4. Vault permanence, reserve assignment and NFT mutation

### 4.1 Required artifacts

`ReserveAssetCommitment v1` must contain collection/program identity, reserve coordinate scheme/version, complete finite inventory commitment, launch/snapshot roots, and either each precommitted future asset identity or the exact verified mechanism that binds a later identity without changing anyone's allocation. Identify who can cause creation and what prevents creation to the wrong owner. Store public commitments and authority identifiers only; no private key generation/export is part of this run.

`MintDrawCommitment v1` must bind operation ID, inventory/stage contract digest, payer/recipient, payment condition, monotonic commitment order, pre-draw inventory root, entropy provider/version, request identifier, promised reveal timing, timeout/refund policy and one result identifier. A confirmed draw consumes inventory once. Owner-approved free/founder mints still consume the same finite inventory fairly. Unknown outcomes hold that commitment; they do not unblock a new draw.

`VaultManifest v1` must bind original supply and exact allocated budgets to reserve coordinates, Season snapshots, claimant scheme, claim program/distribution identities and vesting. It also needs immutable cumulative claim evidence and independent backup references. A production exporter must include enough data to regenerate every proof without the 10X database. A web URL alone is not a durable proof archive.

Publish the immutable inventory commitment once and reference it from compact per-launch manifests; derive slot amounts from the committed scheme. Full export verification may enumerate slots locally, but it must not imply 10,000 database/on-chain writes or token accounts per launch. Keep private draw secrets out of public archives. The decision packet must also account for reveal leakage: a public claim amount or a slot-to-asset mapping may expose Level before a scheduled visual reveal. Do not promise hidden economic rarity while simultaneously publishing enough data to infer it, or silently delay vested claims to preserve a cosmetic reveal. Specify when an assignment becomes publicly revealed and how that timestamp governs free-Season eligibility.

`AssetPolicyManifest v1` must list asset and collection update authorities, plugins/delegates, transfer/execute/burn rules, metadata fields, economic fields, ownership lookup rules, version changes and permitted operator capabilities. Distinguish Genesis's immutable Level from owner-requested visual refresh, and Season Level/progression from immutable historical snapshots.

### 4.2 Why assignment is not already solved

The Core/Rewards fixture commits a known future asset signer and later mints that asset using a controlled disposable key. It demonstrates the claim composition, not unbiased production assignment or safe custody of thousands of future asset identities. The local collection reducer consumes an adapter-supplied ticket; it does not validate an entropy proof. These two facts must remain visible in M4.

Two representations can be costed without selecting one:

- **Precommitted slot-to-asset identities:** every reserved claimant can be known before the first ATT. The decision packet must explain lawful/control-safe creation authority, exact finite slot distribution, hidden/unbiased assignment and how payment/draw/creation failures settle. Publicly predictable rare-slot sequencing is disallowed.
- **Compact class/tranche reserve with later binding:** cheaper state is acceptable only if the selected custody path enforces full class backing, exact quota consumption and permanent asset assignment without replacing past obligations. The existing wallet-address Rewards root does not automatically provide that late-binding primitive. Mark it unsupported until a specific reviewed implementation exists.

A pure class accounting proof does not solve the on-chain binding problem. Likewise, a valid Core asset-signing instruction does not establish the fairness of the mint that chooses its owner.

### 4.3 Burn behavior versus refresh/progression

Product policy is settled: never add a Burn NFT button or API action. External burns are a separate unresolved standard/custody compatibility question. Existing findings are:

1. An ordinary Core asset can be burned externally; its signer then cannot execute and a remaining balance can be stranded.
2. An asset update authority can remove the experimental burn Oracle even when the adapter's own authority is None.
3. A deliberately unreachable update authority plus the frozen Oracle worked in the narrow tested fixture, but restricts ordinary metadata changes.
4. A permanent burn delegate can override that veto. A persistent SPL delegate set by a former owner can also bypass the intended payout ownership check; the existing fresh-account atomic payout avoids using such persistent custody accounts.

Do not paper over this by labeling stranded balances “recovered,” reallocating them or inserting a database owner override. Financial permanence is not met by retaining an amount that nobody can claim.

**DR-V1 — custody/claim permanence:** compare the existing Core asset-signer composition, any specific reviewed alternative, and deferral. Record exact rights, program versions, upgrade trust, practical-max clawback interpretation, proof portability, costs and source/audit coverage. Acceptance requires the current-owner invariant and no administrative sweep of allocated claims. A founder preference alone cannot substitute for technical enforceability.

**DR-V2 — burn and mutation compatibility:** document one compatible policy before committing to Core production assets. Candidate questions for a later focused security review are whether burns can be prevented while preserving strictly scoped visual/progression changes, or whether a separate reviewed recovery entitlement can preserve claims after a defined burn without duplicate rights. An immutable asset referencing changeable off-chain imagery may be explored as a Genesis display option, but it must not be presented as verified economic-state mutation or assumed compatible with marketplaces. Season Level changes need verifiable state and cannot be replaced by an untrusted JSON edit.

The packet must identify each permitted metadata/economic field, its authority, its evidence source and its effect on past/future rewards. Existing historical snapshots remain fixed regardless of the chosen mutation representation. If none of the candidates preserves both confirmed rights and affordable operation, defer the financial release or seek review funding. Do not choose silent forfeiture or an unrestricted operator recovery power.

**DR-V3 — reserve assignment:** compare the two representations above with exact state/account counts and failure/refund paths. Choose only after the identity-binding and fair-assignment evidence exists. A randomness provider and any paid fulfillment service remain unselected. No live integration, key creation or paid experiment is authorized by this blueprint.

## 5. Kamino: principal administration and exact emissions

The existing direct execution result is decisive for the current configuration: an unrestricted farm administrator can appoint a withdraw authority and remove depositor principal. The next run should not repeat that experiment. It should make the necessary authority policy concrete and prevent a planning report from presenting the configuration as financially ready.

`FarmAuthorityPlan v1` must enumerate the actor/controller allowed to initialize, fund, set the curve, change timing, set deposit/withdraw authority, withdraw vault funds, reset a completed curve, recover unused rewards, change global fees, upgrade the program, harvest and withdraw personal principal. For each operation record preconditions, latest permitted phase, amount/destination bounds and evidence of enforcement. “The operator promises not to call it” is not enforcement.

**DR-S1 — operational authority:** cost these candidate classes without choosing an untested one:

- An existing enforceable constrained authority that permits only required upkeep, prevents principal withdrawal and restricts unused recovery to demonstrable surplus.
- Renunciation/immutable setup, only if the resulting program behavior still satisfies end-of-campaign handling and keeps all claims/withdrawals usable. The observed need to restore a default curve before recovery must be addressed explicitly; do not assume an adminless farm can perform it.
- A different reviewed farm candidate if Kamino cannot comply, or a separately funded/reviewed minimal controller. No custom custody program or audited-code fork is authorized by default.

`FarmReconciliation` should expose `fundedRewardUnits`, `userPrincipalUnits`, `earnedGrossUnits`, `harvestedGrossUnits`, `treasuryPaidUnits`, `userPaidUnits`, `earnedUnclaimedUnits`, `idleUnits`, `unissuedUnits`, `roundingReserveUnits` and `recoverableUnits`, with source checkpoint and policy version. Recovery eligibility must be false while any required liability is unknown. After a fee claim, receipts plus treasury must equal the actual gross claim, not a UI estimate.

**DR-S2 — measured farm fees and precision:** retain the target of zero extra platform fee and fixed 5% funding. The observed global accounts had zero harvest fee; the simulation also used a local zero-fee global config. Before selecting an actual farm, identify the exact global account and its change powers. If a future verified candidate charges a nonzero fee, present concrete net receipts and alternatives to the founder. Do not ask the founder to guess a fee now.

The whole-rate fixture certifies only its tested rate. Prepare a representation matrix for plausible `S`, decimals and `S/20/864000`; mark exact versus fractional rate and quantify maximum possible remainder using the pinned arithmetic specification. Actual program fractional rounding and refresh-frequency parity remain separate future validation, not a success inferred from the exact rational reference model. Unused emission destination remains open; a decision must specify recover/burn policy, accountable recipient and exclusions for earned balances.

Sources: S1 §6; S2, S4, S11.

## 6. Quote, oracle and eligibility provenance

Keep distinct outputs for executable trade economics, spot valuation and Earn eligibility:

- **Trade quote:** actual OnlyB fee side, fee-rounded input/output, exact next price, minimum received, price impact, source hashes and expiry. Effective buy FDV is `originalSupply × grossOGSpent × OG_USD / ATTReceived` with decimal normalization; it is not fee-free spot FDV. Network/account expenses stay separate.
- **Eligibility value:** raw staked ATT multiplied by `sqrtPriceX64² × OG_USD_micro / (2^128 × 10^OG_decimals)`, floored once at the micro-USD boundary. This must be at least 10,000,000 micro-USD at both required checkpoints. The previous price is an anomaly detector, never a substitute formula.
- **Company revenue:** reconciled collectible fees after protocol deductions, not total trading fee, spot FDV or an unverified volume feed.

The current 30-second capture lifetime, 15-second quote lifetime, 1% OG confidence bound and 0–500 bps slippage limit are local implementation parameters. Preserve them in versioned fixtures; do not describe them as production liquidity/manipulation thresholds already approved by measured markets. Pricing has its own configured freshness, slot skew, history and depth limits. A unified envelope must permit separate policies without allowing consumer code to reinterpret an invalid source as current.

`PriceEvidence v1` should include:

| Field group | Required values |
| --- | --- |
| Identity | Network/genesis identity; ATT and OG mint addresses, programs and decimals; approved pool, farm where needed, feed ID and source-policy version. |
| Account evidence | Finalized context slot, immutable raw-byte digests, pool state, mint supply/authority interpretation, relevant vault balances, program/configuration identities, independent source reference. |
| Clock | Retrieval/observation time, account-context slot/time, original oracle publication time/slot, receipt time and each explicit expiry. Never overwrite publication time with retrieval time. |
| Value | OG price denomination/exponent, integer confidence, ATT/OG orientation, pool sqrt/liquidity and any measured depth/impact observation at the required slot. |
| Decision | Consumer, policy digest, accepted/pending reason, investigation status, superseded receipt reference and complete source-set digest. |

The next run may implement schemas and offline importer/recovery checks. It must not fabricate signed oracle authenticity, scrape a price as equivalent to a verified feed or use a live trading action to manufacture depth evidence.

**DR-P1 — approved source policy:** identify an actual candidate feed and its licensing, publication semantics, confidence meaning, supported OG coverage and free/paid access. Use existing evidence only in this run; keep unresearched items unknown. A later read-only/source review can choose justified freshness/depth limits and an availability fallback that holds rather than grants eligibility. Exact pre-swap pool bytes paired with SDK/program outputs remain a separate compatibility artifact. The existing 80 synthetic vectors are useful evidence but do not supply that missing artifact.

Sources: S1 LAUNCH-05, EARN-02; S7, S12.

## 7. Cash evidence and costed choices

The cost implementation already distinguishes `reference`, `hypothetical`, `quoted`, `upper-bound` and `product-policy` lines. Keep that vocabulary. An old source or policy formula can inform a comparison; only complete fresh context-bound amounts can make a spend packet eligible for review.

The existing dated components are:

| Component | Dated reference | Meaning and exclusion |
| --- | --- | --- |
| Kamino FarmState, 8,336 bytes | 42,997,120 lamports | One state account; excludes vaults, funding messages, fees and retries. |
| Kamino UserState, 920 bytes | 5,323,840 lamports | Per new participating position as applicable; payer must be explicit. |
| Classic token account, 165 bytes | 1,488,440 lamports | Rent reference, not universal cost per wallet. Check actual existing accounts and layout. |
| Three Core Executes per tested NFT/ATT payout | 146,160 lamports | Observed protocol charge; excludes network, priority, recipient ATA, claim state, temporary account and lookup-table setup. |
| Shared experimental Oracle record | 1,097,280 lamports | Fixture observation only, not a selected production dependency. |
| Core creation protocol fee | 1,500,000 lamports | Dated documentation reference, excluding asset rent/randomness/network. Not an all-in mint quote. |

M7 must add three financial views per payer: **peak upfront cash**, **irreversible consumed cost**, and **expected recoverable capital**. The temporary account used in the existing Vault fixture is created in a separate preparation and closed during payout; do not describe creation as already atomic with claim. Count rent upfront, identify the cleanup/retry liability of an interrupted preparation, and only assume rent recycling when the same cash can demonstrably fund sequential actions. Parallel batches need concurrent float. The calculator currently exposes per-line refundable information, but the proposed peak-cash view requires an explicit operation dependency graph.

For a first production ATT packet, combine disjoint launch, farm, first Earn allocation and Vault setup costs and identify future mandatory liabilities. Do not omit the permanent unminted reserve system because the public Genesis sale is later. For a pilot marked as a separate protocol experiment, describe exactly which product promises it does not issue; it cannot be marketed as a full ATT campaign.

Cost the actual Earn branch: a legitimately empty first-ever board requires a recorded 1% burn; it does not need a recipient claim root for that burned budget. A pending board is neither a burn nor a completed root. Preserve separately any mandatory distributor setup and later-day funding/claim costs, with account reuse counted only once.

Evidence artifacts should include account-role inventory with size/existence/additional rent, exact planned message/fee hash, program/configuration fingerprint, maximum priority/retry amount, per-action randomness/fulfillment costs, proof-hosting/backup costs, payer and refund policy, and separately timestamped SOL/USD and OG/USD sources. Unknown amounts stay null with a named reason. No calculation substitutes reference SOL prices for fresh conversion.

The founder's standing limits are unchanged: ordinary pilot target below US$10 and within 20% of verified cash; a concrete exception may be approved up to US$30. Above US$30 stays local under current policy. Reserve 50% as an advisory planning guideline, not an automatic withdrawal block. Combined **new** recurring services are capped at US$5/month, with warning at 80%. Existing liabilities, user claims, withdrawals and reconciliation must remain serviceable when optional activity stops.

**DR-C1 — pilot cash decision:** present the exact candidate, complete packet, source age, available cash evidence, peak funding requirement, consumed cost, least-cost viable comparison, retry ceiling and balance afterward. Approval is for that bounded operation. No approval is assumed in this overnight run. Founder backstop minting needs its own count and ceiling; unsold NFTs are not revenue. Later mint prices remain unset until the founder publishes them with required notice.

Sources: S1 §15; S6, S13–S15.

## 8. Work boundaries and decision ownership

| Work class | Proceed in the next unattended run | Evidence required to go further |
| --- | --- | --- |
| Pure financial code, typed manifests, local schemas, ordinary regression tests, export/import and UI reports | Yes, within the packages above and existing authorization. | Reviewed commit, deterministic test output, input/output artifact hashes and a limitation list. |
| Choosing global UTC board policy for implementation scaffolding | Preserve the existing versioned proposal; no hidden timing change. | Publication/confirmation before financial use; actual `T` always controls token clocks. Sydney staffing hour remains independent and open. |
| Selecting an NFT custody/burn/mutation architecture | Prepare comparative decision records and state/account inventories only. | Independent protocol/security review establishing enforceability and compatibility with permanent rights, refresh and Season progression. A changed product promise needs founder decision. |
| Kamino administrative restrictions, custom controller or fallback protocol | Prepare permission/state/precision requirements and cost alternatives only. | A specific reviewed design and applicable license/source/deployment evidence. Separate authorization for any new security experiments or funded work. |
| Signed chain calls, local authority/security probes or new captured-program experiments | Not part of this planning blueprint's unattended scope. Optional public, free, uncredentialed reads follow EXECUTION.md; no charged provider account is used. | Separate scoped instruction; never infer authorization from this backlog. Existing findings can be incorporated without rerunning them. |
| Randomness/marketplace/wallet selection | Prepare requirements, decision matrices and exact missing evidence. | Verified compatibility and actual complete costs; physical-wallet/user participation where needed. No service purchase or new account. |
| Funded pilot, paid generation, subscription, key provisioning or deployment | No. | Concrete reviewable result, explicit bounded spending/release approval and completed financial gates. No production deployment remains in force. |

Each decision record should contain: decision ID/status, requirement IDs, options, selected/default/deferred distinction, exact evidence references and dates, affected cash/rights, unresolved assumptions, implementation scope, approver/reviewer and invalidation triggers. Do not reopen settled economics to avoid a difficult integration. Return a costed incompatible option as a decision, not an implementation shortcut.

The morning handoff should include completed milestone commits, a machine-readable gate report, the Vault export/recovery example, reserve/mutation and farm-authority decision packets, shared price-evidence examples, a cost comparison with unresolved terms, and a short list of concrete decisions. No question about Sydney hours or later mint prices is needed to finish these artifacts.

## 9. Source map

All references below point to the reviewed local checkout. Function names and PRD requirement IDs are the stable anchors if line numbers move in later implementation.

| ID | Exact source | Relevant anchor |
| --- | --- | --- |
| S1 | [PRD v1.2 source](../../spec/prd-v1.2-source.txt) | §§4–10, 13–18, 22; LAUNCH/VAULT/STAKE/EARN/GENESIS/SEASON IDs; G1–G6. |
| S2 | [Protocol status](../../validation/protocol-status.md) | Actual captured-program results, dated binary observations, open compatibility gates and corrected review findings. |
| S3 | [Launch math](../../domain/economics/launch.mjs), [Vault math](../../domain/economics/vault.mjs) | `launchAllocations`, `launchFeeBps`, `genesisSlotEntitlement`, cumulative vesting and `createSeasonSnapshot`. |
| S4 | [Stake math](../../domain/economics/stake.mjs), [Kamino evidence](../../lab/KAMINO.md) | Exact rational reference versus observed whole-rate program execution; principal-admin and license findings. |
| S5 | [Vault ledger](../../vault/ledger.mjs), [campaign registry](../../launch/registry.mjs) | `recordVaultManifest`, `observeAsset`, `seasonsAt`, atomic `registerCampaign`. |
| S6 | [Core claim evidence](../../lab/CORE-VAULT.md), [Rewards evidence](../../lab/REWARDS.md) | Current-owner composition, 14-sibling proof, three-Execute costs, external burn/delegate/mutation limitations, finite-max clawback and source coverage. |
| S7 | [Quote account decoding](../../quotes/accounts.mjs), [quote arithmetic](../../quotes/math.mjs), [quote evidence](../../quotes/evidence.mjs) | SDK-pinned layout, `validateQuotePool`, `quoteAmounts`, `quoteValuation`, checkpoint regression/hold, expiry. |
| S8 | [Collection reducer](../../domain/collections/inventory.mjs), [progression reducer](../../domain/collections/progression.mjs) | `admitMint`, `applyVerifiedMintDraw`, `prepareProgression`, `applyVerifiedProgressionDraw`; supplied proofs are future-adapter inputs. |
| S9 | [Collection storage/adapter guide](../../collect/README.md) | Mint-result and Vault binding, reveal/transfer, progression locks, free-stage evidence, pending entropy/escrow gates. |
| S10 | [Earn settlement](../../domain/earn/settlement.mjs), [Earn archive](../../earn/archive.mjs), [Earn guide](../../earn/README.md) | `allocationWindow`, `distributeBudget`, `exportBoard`, `proofForWallet`, `importBoard`; public SHA-256 proof format is offline-only. |
| S11 | [Farm fixture ledger](../../stake/farms.mjs) | `seedFarm`, `observeFarm`, ordered bounded event imports; hypothetical fee is explicit. |
| S12 | [Eligibility pricing guide](../../pricing/README.md), [eligibility evidence](../../pricing/evidence.mjs), [quote guide](../../quotes/README.md) | Separate consumer policies, raw-unit valuation, manipulation holds, SDK evidence and absent program-state parity. |
| S13 | [Cost scenario catalogue](../../costs/scenarios.mjs), [reference components](../../costs/reference.mjs), [cost guide](../../costs/README.md) | Fourteen scenarios, dated lamport components, payer distinctions and unknown prices. |
| S14 | [Cost packet](../../costs/packet.mjs), [budget policy](../../costs/budget.mjs) | Exact context binding, rent existence, conversions, complete/partial state, first-ATT aggregate and founder limits. |
| S15 | [Transaction rehearsal](../../transactions/README.md), [intent lifecycle](../../transactions/intents.mjs), [capabilities](../../contracts/capabilities.mjs), [operations guide](../../operations/README.md) | Immutable plans, ambiguous receipts, local-only state, disabled financial routes and preserving claims during optional-work holds. |

This blueprint intentionally records unknowns instead of resolving them by assumption. It specifies useful implementation that can finish before choosing a custody architecture or spending money.
