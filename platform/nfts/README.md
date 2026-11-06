# Private metadata permission foundation

This local, pure boundary adapts named Collect inventory/asset/slot columns. It is not a second ownership ledger, public metadata endpoint, storage mutation, media provider, or chain authority. The adapter deliberately retains concealed Level, traits and coordinates privately. A reveal-gated public adapter is still unavailable.

`metadataFromCollect` preserves the existing nine-field asset shape and original trait strings. Genesis Level must equal the immutable reserved slot Level. Season expiry uses the existing calendar calculation from the original Season start. Asset, inventory, slot and start cannot be substituted during supported transitions. No allocation, claim or account-update payload is accepted.

`inspectGenesisImageProposal` binds a reference, preview and quote digest to the current Genesis owner/version. These hashes do not prove artifact existence, moderation, approval or generation. A changed preview has a different binding; fulfillment must obtain fresh approval and independently recheck owner/version. No image is applied by this foundation.

`inspectProgressionMetadata` replays the existing `prepareProgression` and `applyVerifiedProgressionDraw` reducers against one or two locked Season assets. It checks the retained result shape and exact participant effects. A caller-supplied committed-looking receipt is never authenticated here: every result explicitly says structural compatibility, unverified receipt authenticity and no authorization. A future repository must establish committed receipt/effect lineage, entropy provenance, current versions and absence of holds. This module does not accept manual outcomes as production fairness.

`inspectMetadataTransfer` checks preservation of lifetime reroll count, cooldown, traits and expiry. Pending locks are not cleared. It is a shape check, not a transfer observation importer.

The permission/recovery dossier records unresolved external-burn, burn-veto removal, unreachable update-authority, permanent-delegate and asset/collection custody conflicts from `platform/lab/CORE-VAULT.md` and `platform/validation/protocol-status.md`. An unsigned B15 plan cannot override them. Historical allocations/claims and every image revision must be retained; restoring media requires a new authorized revision.

All inputs are bounded data-only structures (32 KiB outer input, 16 KiB asset JSON, 4 KiB slot JSON). Getters, unknown fields, duplicate JSON properties, sparse arrays and malformed identities are rejected. Financial state is always `not-applicable-local`; signing, broadcast and financial execution are unavailable.

The pure metadata helpers are B17 step4/6 foundations. Separate guarded repositories now provide reveal-gated fairness disclosure and authenticated, recoverable local refresh revisions. No provider, custody configuration or on-chain metadata mutation is selected.


## Refresh rehearsal and recovery

The refresh reducer retains `draft -> reference-validated -> moderation-pending -> preview-ready -> owner-approved -> fulfillment-pending -> fulfilled`, with rejected, failed and owner-changed outcomes. `fulfilled` is possible only for an explicitly recorded synthetic rehearsal: `metadataApplied:false`, `receiptAuthenticity:unverified`, and `isAuthorization:false`. An unselected provider stays unavailable. No image generation, payment or asset update occurs.

Each retained event includes its actor, original input, observed owner/version, event digest and outcome. Restoration replays the complete history. An event ID with the same input returns its original outcome; different input conflicts. Failed provider retries retain the original job identity and preview binding. Sixteen events and 32 KiB bound a rehearsal; reaching that bound holds further progress rather than dropping history.

Ownership or version changes before approval invalidate the proposal. Changes after approval permanently hold fulfillment, even if ownership later returns. Reference, preview and quote substitution fails. These are structural rules; authentication and fresh database observations belong in the repository boundary.

The private checkpoint adapter writes the exact canonical state through the existing immutable ArtifactStore, then verifies readback and replays it. Retain the returned exact-byte/request/state pin independently. Unknown writes retry the same identity; missing or corrupt objects never produce a restored state. A checkpoint preserves historical rehearsal data, not an authenticated latest-state pointer or current ownership claim. It cannot be published as public metadata.

## Fairness disclosure boundary

The collection fairness projector returns only an opaque domain-separated commitment and separate request/evidence/financial states while sealed. It withholds the raw commitment, request context, proof, round, order and outcome. A revealed transcript requires irreversible assignment, the selected asset's permitted reveal and complete reveal coverage for the earlier mint prefix (or every progression participant). Unit-supplied gate flags are not authorization: the repository must establish their retained evidence lineage.

After those gates, replay uses the original recorded round, commitment and existing draw algorithm. Verification covers that recorded draw only. Full reserved-map policy closure, real paid admission order and custody remain separate requirements. The future asset map is never included. Missing proof, verifier or replay inputs stays sealed; conflicting evidence holds the result. No redraw, selective cancellation or refund route exists.

## Permission and recovery matrix

| Surface | Locally checked rule | Remaining authority requirement |
|---|---|---|
| Genesis image proposal | Reference/preview/quote and owner/version binding; no economic fields | Authenticated moderation/owner approval, verified media artifacts and selected update custody |
| Season progression | Existing domain replay; original start, derived expiry and lifetime rerolls | Authenticated committed effect lineage and accepted entropy |
| Transfer | Immutable identity/economics and preserved counters/cooldown | Accepted owner observation and current version fence |
| Fairness transcript | Same recorded draw, reveal gates and sealed field allowlist | Trusted assignment/reveal history; no production order/custody claim |
| Private refresh checkpoint | Independent byte pin, canonical encoding, full event replay and committed069 revision lineage; recovery binds immutable Collect/Vault identity | Production media/update custody remains unresolved; local fixture completion never applies metadata |
| Historical Vault claims | No metadata mutation channel | Permanent claim/custody design and financial review |

On interruption, retain the same operation, commitment, provider job and every history revision. Pause new proposals if evidence is unavailable. Do not clear a lock or replace a draw to make a hold disappear. Existing external-burn, update-authority and permanent-delegate incompatibilities stay unresolved; an unsigned transaction plan grants no authority.
