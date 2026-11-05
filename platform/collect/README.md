# Local collection inventory

This SQLite fixture ledger tracks Genesis tranches, monthly Seasons, mint stages, commitments, reveal observations and progression. The browser can reserve a fixture slot or request a local upgrade or reroll. An operator CLI imports the subsequent evidence. No request signs a transaction, transfers SOL, creates a mainnet NFT or generates verifiable entropy.

Run from `platform/`:

    node collect/operator.mjs create collection.json
    node collect/operator.mjs stage stage.json
    node collect/operator.mjs inspect operation.json

Create a Genesis inventory with `{"id":"genesis-1","kind":"genesis","tranche":1}`. A Season uses `kind:"season"` and a published `seasonStart` timestamp, in Unix milliseconds. One inventory may occupy each of ten Genesis tranche numbers and each UTC Season month.

Publish a stage with `inventoryId` and a `stage` object. Required fields are `id`, `type`, `publishedAt`, `opensAt`, `closesAt`, `allocation`, `priceLamports`, and `costLamports`. The last two are decimal strings. Cost represents the disclosed local creation/network quote per NFT. Supply `wallets` for whitelist and founder stages, and the applicable `walletLimit` for paid or founder Season stages. Public access requires `founderApproved:true`. A founder backstop also requires `approvedSpendLamports`, covering the total creation cost. The first stage of a later Genesis tranche references the prior opening’s `ballotId`. A published `inventoryOverrideReason` is needed to proceed with unsold prior inventory. Opening still waits for the founder’s ballot decision and notice period.

For a Season free stage, run `snapshot` with `inventoryId`, `stageId`, `sourceRef`, `finalized:true`, `at` equal to its opening boundary, and `holdings`. Each holding supplies an ID, owner, collection, publicly revealed Level and reveal timestamp. `collection:"solana-genesis"`, publicly revealed Level 1 and ownership at the snapshot establish eligibility. Unknown Level/reveal use null. The importer rejects conflicts with locally observed Genesis ownership and reveal data. It trusts the operator’s finalized external fixture evidence; verifying a complete real chain snapshot remains a release gate.

The server accepts authenticated, same-origin requests using an `Idempotency-Key`. Send `{}` to `POST /api/v1/collect/inventories/{id}/stages/{stage}/reservations`. The operation remains pending until fixture evidence arrives. Inspect its ID with `inspect` to obtain the committed request reference. Supply `mint-result` with `operationId`, `commitment`, `proofId`, `finalized:true`, `at`, `assetId`, `ticket` and `traits:{model,backdrop,symbol}`. Commitment order is fixed. Tickets index the remaining Level quota. The adapter must supply a consistent, unbiased ticket for that commitment; this CLI intentionally does not act as a randomness oracle. Owner-approved founder inventory uses the separate `founder-mint` CLI. Mint bindings and Vault slot bindings commit together. Slot ordinals are zero-based within initial Level. Season slots are ordered by ascending initial Level and then by ordinal.

Use `observe` with a unique `sourceId`, `assetId`, `at`, `finalized:true` and `kind:"reveal"` or `kind:"transfer"`. Transfers specify previous and new wallets in `from` and `to`. Mint and transfer observations use whole-second chain timestamps represented in milliseconds. Unrevealed collection projections omit the Level and traits.

Progression requests use `POST /api/v1/collect/inventories/{id}/progression` with `kind:"upgrade"` or `"visual"`, `targetId` and `expectedTargetVersion`. Upgrades add `materialId` and `expectedMaterialVersion`. Both assets are locked in the same transaction. Recover the original commitment with `inspect` and settle using `progression-result`. It takes the same proof envelope as a mint plus a ticket for a material redraw or all three visual traits for a visual reroll. Failed validation preserves the existing lock. Successful fulfillment starts the cooldown. A subsequent transfer retains the asset’s progression state.

Read inventories at `/api/v1/collect/inventories` and specific assets at `/api/v1/collect/assets/{id}`. A signed-in wallet can page through its holdings and operations at `/api/v1/collect/me/assets` and `/api/v1/collect/me/operations`. Receipts persist across restarts. Reveal status and fee amounts are explicit. Currency values are lamports and all results are local fixtures.

The bounded reference reducer stores one snapshot per inventory, up to 1,000 admissions, 32 published stages and 10,000 addresses per whitelist. Before a hosted or paid mint, measure worst-case serialization cost and replace large aggregate rewrites with indexed conditional transitions if needed. On-chain evidence verification, robust entropy timeout/refund handling, escrow locks during transfers, legal review and supported marketplace behavior remain release gates.
