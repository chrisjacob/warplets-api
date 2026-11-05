# Policy and architecture contracts

This file fixes engineering choices for the execution queue. Confirmed product rules come from PRD 1.2. Engineering defaults below authorize local implementation choices, not financial release. When a supporting design appendix offers a different ordering or path, this file and the B task cards control.

## Policy constants and time

| Subject | Required behavior |
| --- | --- |
| Supply | Original base-unit supply S is immutable. Preserve the current exact-representability rule S positive u64 and divisible by 200. Budgets are 80%, 10%, 5%, 2.5%, 2.5%. A different rounding policy needs a prospective decision. |
| Fee | For elapsed whole seconds s ≥ 0, feeBps = max(100, 9000 − 100s). Before activation, no executable quote. Seconds 89 and later are 1%. |
| Campaign | At most one actual launch per Australia/Sydney date and at most ten overlapping ten-day campaigns. Skip creates no budget. No fixed morning/evening hour is selected. |
| Vault | Zero vested through T+24h, linear thereafter, full at T+48h. Claimed units subtract from cumulative entitlement. Mint/transfer never restart the clock. |
| Genesis | Ten reserved tranches, 1,000 slots each, Levels 1–10 with counts 489/256/128/64/32/16/8/4/2/1. Denominator 20,130 includes all unminted slots. |
| Seasons | Same initial 1,000 slots. Active weight includes unminted slots at initial Level until expiry. Freeze launch-time Levels/denominator. Calendar-month expiry is original Season start plus current Level with UTC clamping. |
| Empty Season weight | The entire 5% Vault allocation goes to Genesis for that launch permanently. |
| Stake | Same ATT, 5% gross funding, ten-day continuous emissions, no warmup/cooldown. Idle emissions never become catch-up rewards. Principal and earned unpaid rewards remain protected. |
| Earn | One global Top 100; one submission per wallet/token/UTC board; highest eligible contribution per user; at least $10 of corresponding stake at entry and cutoff. |
| Multiplier | Tenths of X. max(1, actionTenths + streakDays + 3×highestEligibleLevel + min(50,purchaseTokenDays)), bounded by valid component maxima to 100. No 1X base. |
| Awards | Each token/day budget is 1% S. Iterative 10% per-wallet cap, proportional redistribution, floor base-unit payouts, burn the unassigned remainder. A ledger burn allocation is not a confirmed chain burn. |
| Streak | Approved, positive-score, stake-eligible content only. Gap ≥24h resets. At most one increment per board, maximum ten; non-winners may qualify. |
| Purchase credit | Preserve conservative combined buy/deposit credit and withdrawal-first deduction; no reward recursion; last ten closed flags, active eligible positions only, maximum fifty token-days. |
| Genesis sale | First whitelist 0.1 SOL; later prices remain null until published. One mint per eligible wallet per stage, shared tranche inventory, 48h notice. Public stage requires founder decision. |
| Vote | Frozen union of Genesis holders and next whitelist; one vote/wallet, 48h, ASAP/7/14/30, turnout visible at any count. Founder rationale is separate. |
| Season progression | Same owner/Season/Level 1–9 pair. Target +1, material independently rerolls original Level distribution; no burn. Fee 0.01×L SOL. |
| Visual reroll | All three visuals change, Level unchanged; fee 0.01×2^r SOL and cooldown 2^r hours from successful completion. Counter survives transfers. Overflow is unavailable. |
| Free phase | Only publicly revealed Solana Genesis Level 1 at the immediate pre-phase snapshot. One mint/wallet, not per NFT; Season 1X alone fails. |
| Finality | Published Earn scoring/eligibility/awards are final. Repairs may deliver the recorded award; they may not rerank or silently remove it. |
| Burn | No NFT burn UI, API action or typed transaction factory. External asset destruction is an unresolved custody case, not permission to extinguish liabilities. |

Internal application times remain safe integer Unix milliseconds. Domain economics already uses BigInt seconds. Convert only through explicit named helpers and reject fractional/unsafe conversions. HTTP timestamps use UTC RFC3339. Never compare a slot number to a timestamp or derive on-chain activation from browser time.

Current local board mapping is a versioned engineering proposal: e0 is the UTC day containing activation T; allocation d uses board e0+d−2 and vests over [T+d days,T+(d+1) days], d=1..10. First-ever legitimately empty board burns only the first 1% allocation. Missing evidence holds that exact board. Preserve this implementation for the overnight run and flag it for release ratification.

## Architecture decisions

1. Keep platform/ as the isolated modular backend and site workspace. Do not rename the repository into a new monorepo or convert all existing MJS to TypeScript.
2. Keep pure domain functions synchronous, deterministic and integer-based. New application ports and Worker adapters use TypeScript where useful; compatibility wrappers preserve existing CLI and Node tests.
3. HTTP handlers validate transport and establish principal/context, then call services. Services own use cases. Repositories own named atomic transitions. Protocol/read adapters own external formats and provenance.
4. One Cloudflare Worker plus D1 and R2 is the intended hosted shape. Local Node remains a reference adapter and useful operator/demo harness. No new database/service/queue is selected overnight.
5. Explicit runtime capabilities describe only implemented routes. All production execution flags remain false. A successful local port may add a local route capability after tests, never an enabled financial claim.
6. API v1 stays additive where possible. Preserve lowercase existing error codes, negotiated envelopes and existing paths. The PRD endpoint catalogue was proposed; do not rename working collection paths simply to match it.
7. Separate public data, private evidence and operational authority. Public SSR calls only public APIs with a fresh cookie-free request.

Proposed new areas are platform/application/, platform/evidence/, platform/jobs/, platform/artifacts/, platform/recovery/ and platform/storage/{node,d1}/. Use one concept per module. Retain current domain owners and existing read projections.

## Application and persistence interfaces

The initial context is injected and immutable per request:

~~~ts
type ApplicationContext = {
  clock: Clock;
  ids: IdSource;
  crypto: CanonicalCrypto;
  repositories: Repositories;
  evidence: EvidenceReader;
  artifacts: ArtifactStore;
  jobs: JobPort;
  telemetry: Telemetry;
  executionPolicy: { mode: "local-validation"; financialExecution: false };
};
~~~

Named Promise-returning repository commands include admitSubmission, recordFinalReview, loadBoardInput, commitBoard, commitAllocation, reserveCollectionOperation, applyCollectionObservation, acquireJob and publishArtifactReference. Queries return DTOs and dependency revisions, not driver rows. Do not expose arbitrary SQL or transaction callbacks to handlers.

B02 also supplies the minimum scope, staffing, quota/cost-reservation commands and private immutable ArtifactStore needed by downstream evidence, jobs and admission. Metrics dashboards and public publication come later. Do not admit work before these controls exist. Private evidence persistence must not depend on the later public archive task.

Every command carries principal, operation kind, business identity, request key, canonical request digest and explicit expected revisions. A stored receipt contains the same identity, output digest, status and result reference. Replays recover the original result even when new admissions have since paused. Changed payload under the same key conflicts.

SQLite adapter executes its synchronous transaction body without awaits. D1 adapter uses one guarded batch per bounded atomic command. Read/compute happens before commit. All relevant revisions and lease/authority predicates are rechecked in SQL; every child write is gated to a newly claimed attempt nonce. A final SQL assertion must abort on missing mandatory effects. An UPDATE matching zero rows is not automatically a rollback.

For larger plans, stage immutable rows that readers cannot see, verify counts/digests, and atomically publish a final pointer. Never expose half a board or token allocation. D1 batch rollback behavior is documented in the [D1 binding reference](https://developers.cloudflare.com/d1/worker-api/d1-database/); the application's exact guard algorithm is specified in [the persistence design](design/storage-earn.md).

## Evidence envelope and authoritative source

~~~ts
type EvidenceEnvelopeV1 = {
  version: 1;
  evidenceId: string;
  mode: "synthetic-fixture" | "recorded-public" | "runtime-read";
  chainGenesis: string | null;
  sourceId: string;
  sourceRevision: string;
  subject: { kind: string; id: string };
  requestedCutoffMs: number | null;
  contextSlot: string | null;
  blockTimeMs: number | null;
  retrievedAtMs: number;
  ingestedAtMs: number;
  finality: "unverified" | "confirmed" | "finalized";
  decoderVersion: string;
  byteDigest: string;
  objectRef: string;
  supersedes: string | null;
};
~~~

Validation returns verified, pending, incompatible or invalid with machine-readable reasons and a verification-receipt digest. It never trusts the input envelope's mode/finality without its source adapter. Synthetic fixtures remain clearly synthetic. Raw private objects do not appear in the public manifest catalog.

A cutoff manifest enumerates every required subject, requested boundary, selected evidence receipt, decoder/source revision, known gaps and dependency revision. It can be complete only after admission coverage, moderation, both stake checks, NFT ownership, purchase history and relevant prior streak/board dependencies are accounted for. Rejected content need not demand irrelevant closing stake data. A valid empty bootstrap has positive evidence that no qualifying predecessor campaign existed.

A current account read cannot recover old cutoff state. minContextSlot is a lower context bound, not a historical-state query. Use captured coverage or verifiable reconstruction; otherwise keep the required component pending. [Solana account reads](https://solana.com/docs/rpc/http/getmultipleaccounts) return ordered account values and a response context; [signature history](https://solana.com/docs/rpc/http/getsignaturesforaddress) and [transaction lookup](https://solana.com/docs/rpc/http/gettransaction) provide different inputs, with potentially missing timestamps/results.

Keep RPC context, chain block time, oracle publish time, retrieval time and application cutoff separate. Do not manufacture common-slot evidence by overwriting timestamps. Historical reconstruction must prove completeness of relevant changes, including external withdrawals/transfers, or report a gap. Preserve the current integer pricing formula and registered source bounds.

## Jobs and publication

Jobs use a unique business key, payload digest, checkpoint, ready time, bounded attempts, lease token, lease expiry and revision. States are queued, running, held, retry, completed and failed. Lease acquisition and every completion are conditional. Stale lease holders cannot publish. Evidence holds wake only on new dependency evidence or explicit bounded retry time; they do not spin.

The first runner is manually invoked/local. No live cron is added. Proposed application ceilings are at most 20 ready jobs per tick, 100 bound parameters per SQL statement, 256 KiB serialized batch payload and a short configurable deadline below the runtime limit. These are conservative engineering ceilings; measure and tighten them. Do not claim they are provider pricing limits.

Artifact publication is a saga: planned → stored → byte-verified → catalog-published, or held. D1 and R2 have no shared transaction. Write content-addressed bytes first, verify them, then publish the allowlisted pointer under a current source revision/fence. Exact retries recover the same object. Conflicting bytes are held, never overwritten.

Store both semanticDigest (domain commitment) and byteDigest (SHA-256 of exact serialized bytes). R2 public/{byteDigest}.json is addressed by bytes. Earn proofs continue to bind their original semantic formats. Retain older published versions indefinitely while they carry liabilities. Temporary orphan cleanup cannot delete published claim data.

## State and authority distinctions

| State family | Meaning |
| --- | --- |
| Application request | A recorded local intent or reservation; it is not a paid/minted/staked chain result |
| Evidence | Recorded or verified observation with provenance and explicit completeness |
| Economic decision | Immutable moderation, ranking, amounts and declared vesting |
| Publication | Public artifact exists, verifies, and is referenced by an immutable catalog |
| Transaction attempt | Exact packet plus signature/observed chain outcome, separate from its stable economic intent |
| Financial execution | Disabled throughout B tasks; enabling needs R-stage approval and verified protocol authority |

An unknown transaction may only reconcile the same attempt/signature. It does not imply failure or permission to resend. An unsubmitted expired packet can be replaced only under the same still-unfulfilled intent and a newly verified plan.

If external evidence changes after final publication, preserve the published decision and record an incident. No administrative correction may silently alter recipient, amount or historical NFT denominator.

## Public and private read contracts

Every monetary field includes token identity, decimals or an explicit base-unit label, and source status. Missing prices are unavailable, not zero. Fiat estimates show observation age and remain separate from executable net output.

Lists have stable ordering/cursors bound to their snapshot. Personalized eligibility and receipts are private and no-store. Public metadata and summaries use explicit version keys and small cache lifetimes; quotes, balances and intents never enter a shared cache. HTTP metadata should expose genuine sourceSlot when known and null otherwise.

Inventory counts distinguish paid, free, founder, pending, unsold and reserved. Concealed slot-level rarity, trait results and future assignments are never leaked through APIs, HTML, Vault previews, metadata or pagination. Published aggregate initial quotas are allowed.

Local paid-stage assignments are labeled paidStageAllocations, not paid sales or revenue. Verified payment receipts remain unknown without a payment adapter. Before reveal, withhold any salt, selection context, proof, round/order or remaining-inventory combination that reconstructs a future result, including owner receipts. Economic claims may themselves reveal rarity; the eventual custody/reveal policy must acknowledge that instead of delaying vested rights silently.

Free-stage evidence always describes the published stage.opensAt boundary. The first accepted snapshot freezes the evidence for that boundary; it never moves the boundary to reservation time. Progression accepts quoteId, quote digest, both asset revisions, policy/price version, expiry and a total fee ceiling atomically with the reservation. Resolve an already accepted replay before checking a new quote's expiry or current pause state.

## Financial release invariants

The first production ATT requires verified backing of every promised allocation, including unminted Genesis reserves, even if the public mint and dashboards are later phases. A partial protocol experiment cannot be presented as a fully funded ATT launch.

Stake is 5% gross funding. Any measured third-party fee reduces disclosed net receipts or requires a separate approved alternative; it never silently changes the token split. Idle recovery excludes principal and earned unclaimed rewards. The existing unrestricted-administrator principal-withdrawal counterexample is a failed release gate until a specific enforceable design resolves it.

No NFT burn action in the app does not protect against external burns. An unreachable update authority may conflict with image refresh and Season progression; permanent delegates can alter safety assumptions. Keep the exact candidate policy unselected until those rights are verified together.

Wallet-bound Earn leaves and asset-signer Vault leaves have different claimant semantics. Portable SHA-256 archive commitments are not Rewards-program Merkle proofs. Decode, label and verify each format separately. A fixture current-owner claim is not proof of production reserve assignment or permanence.

B17's offline metadata/fairness workflows and B19's decision dossiers remain implementable without a chosen custody or randomness provider. They must expose unresolved compatibility, not invent production authority or initiate new authority probes.

## Cost and failure defaults

No paid spend is approved for the overnight run. Keep the first-test target below US$10, an exception ceiling of US$30 only with later explicit approval, combined new recurring ceiling US$5/month, and 50% reserve as a reported guideline rather than an automatic block.

Preserve payer, denomination, gross reward funding, protocol charge, consumed cost, refundable rent and peak cash separately. Unknown nonzero cost terms block a complete quote. Current quote source values are dated observations, not standing approvals.

Provider failures preserve prior public records with age and held status. Missing evidence never becomes a zero balance, rejected contribution or empty board. Authentication/input failures are terminal; retryable transport errors have bounded backoff. New work pauses do not erase existing claims, recovery data or reconciliation receipts.

## Unattended decisions and deferred choices

Proceed without questions on file layout within platform/, test naming, typed ports, additive schema, offline source adapters, canonical serialization, local UI improvements and error handling. Record significant architectural choices in decision files.

Keep launch hour, later prices, public sale authorization, actual provider selection, paid refund/timeout policy, physical wallet support, NFT custody permissions, any nonzero third-party farm fee and real deployment unresolved until their concrete review packets exist. These choices block their financial feature, not the rest of the B queue.
