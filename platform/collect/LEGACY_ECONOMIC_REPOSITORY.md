# Durable private historical economics

`createLegacyEconomicRepository` continues an economic audit beneath a ready 051 source-relation audit and its genuine 050 fingerprint parent. The same operator must hold `collection-import`. Every phase checks the exact schema, current recovery generation/status, inventory revision, whole-business watermark and committed 035 staging/source-seal receipt lineage. These private control/proof tables are excluded from recovery and do not advance the business watermark. A restored or changed source needs new preparatory audits.

The final result means **historical local economic consistency under the retained evidence**. It explicitly reports `historicalEconomics: true`, `originalOperatorAuthentication: false`, `paymentVerified: false`, `adoptionAuthorized: false`, and `executable: false`. It creates no collection authority, wallet intent, payment, 045 admission receipt or 046 fulfillment receipt.

## Named API

- `start(operator, {auditId, relationAuditId, asOfMs, stageOriginals})` captures one immutable ordered original-stage artifact selection. All stages require proof, including stages without admissions. The parent relation is unique to one economic attempt.
- `step(operator, {auditId, expectedRevision})` executes the next bounded phase. There is no caller checkpoint, mapped fact, prefix, quota or approval input.
- `selectOriginal(operator, {auditId, expectedRevision, original})` commits a manual fixture/configured policy artifact reference, or explicit null, before admission-source or original-mint computation. Retrying the same selection reads its immutable proof; a changed selection conflicts even after later phases advance.

A held attempt retains its exact prefix/context/phase. Correcting an artifact selection requires a new genuine 050/051 parent and a new economic attempt. No prefix reset or import API is exposed. Missing artifacts with a retained identity can be diagnosed honestly; the workflow never reconstructs missing originals from mutable NFT traits.

## Phase protocol

1. `stage`: one B11-37 original publication verification per call, with an immutable stage proof. Missing originals hold even for an unadmitted stage.
2. `initialize`: B11-31 constructs the zero economic prefix from the exact named 035 root after every stage proof exists.
3. `select`: persist one private original-mint reference without performing the economic computation. `step` returns `awaiting-original` until this explicit selection occurs.
4. `prepare`: B11-33 reads the actual original operation and prior admission/index facts.
5. `control`: B11-32 reconstructs the retained historical control decision at the operation's original creation time.
6. `mint`: B11-39 verifies a settled original mint from its database facts and independently hashed private artifacts. A genuinely pending admission records a null mint audit; it does not invent settlement evidence.
7. `membership`: B11-40 verifies the original fixed list/index membership, or unrestricted public eligibility. Its page bytes are persisted as bounded base64, then decoded only for the next phase.
8. `advance`: B11-31 checks exact historical allocation, wallet limit, founder cost budget, request/commitment identity, settlement order and Level quotas, then atomically advances the private prefix with its immutable summary.
9. `closure`: B11-33 checks final operation/admission uniqueness and completeness.
10. `finish`: B11-31 compares exact final counts/quotas/stage totals and records the deliberately limited final result.

Each successful stage/phase proof hashes its canonical body. A chained digest binds the prior chain, audit ID, phase, stage index/admission ordinal and proof digest. Initialize and finish retain the chain. Source-fenced proof inserts and control updates share one batch; SQL mandatory-effect guards require the exact corresponding proof and context value. A final batch assertion also rolls back a proof if its control update was omitted. Positive claim changes plus the retained nonce identify the winner; lost acknowledgements resolve from durable rows. Colliding nonces do not turn a losing claimant into a winner.

## Supported and held profiles

The slice supports original whitelist, public and founder economics; empty inventories; unadmitted stages; and ordered pending/settled prefixes with retained manual or configured beacon originals. Founder budget accounting includes pending reservations and keeps local cost separate from mint price. The retained control history is an as-of reconstruction, not proof of original authentication or original ingestion-time contents.

Free admission remains held without independent original known-local-asset completeness/historical ownership evidence. B11-36's preimage/wallet projection result is never promoted to that authority. Later Genesis first admissions remain held without original opening/ballot/previous-supply evidence; current previous inventory state cannot fabricate it. Missing stage, mint, policy, membership, historical control or source proofs remain explicit holds.

## Bounds and validation

One invocation is limited to 64 SQL/object operations, 256 KiB serialized SQL batch and 1 MiB conservative working payload. Full original-stage arrays are not hydrated with a large mint audit: the control read projects only the currently selected stage identity. The run stores at most 8 KiB prefix and 32 KiB context; stage proofs are at most 8 KiB and phase proofs at most 32 KiB. Large source/policy/context combinations that exceed the complete wrapper limit hold rather than silently dropping validation.

Reference acceptance uses actual legacy operations and genuine 050/051 parents. Actual D1 acceptance creates its own pinned parent, uses fresh service/hash instances across requests, and compares economic results with Node. Fault tests cover changed selection, caller prefix injection, omitted proof/update, altered previous context or new proof value, lost acknowledgement, nonce races, scope/source/schema/generation changes and final-prefix disagreement. The configured path uses retained original parts; real workerd acceptance uses the installed pinned beacon verifier. No external provider is called.

The 1,000-admission capacity rehearsal uses actual pending legacy admissions and all 6,001 immutable phase records, rather than fabricated final counters. It is a local workload measurement; continued invocation limits are checked independently for every step. See B11-41 evidence for exact counts, durations and measured peaks.
