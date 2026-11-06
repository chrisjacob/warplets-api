# Private metadata permission foundation

This local, pure boundary adapts named Collect inventory/asset/slot columns. It is not a second ownership ledger, public metadata endpoint, storage mutation, media provider, or chain authority. The adapter deliberately retains concealed Level, traits and coordinates privately. A reveal-gated public adapter is still unavailable.

`metadataFromCollect` preserves the existing nine-field asset shape and original trait strings. Genesis Level must equal the immutable reserved slot Level. Season expiry uses the existing calendar calculation from the original Season start. Asset, inventory, slot and start cannot be substituted during supported transitions. No allocation, claim or account-update payload is accepted.

`inspectGenesisImageProposal` binds a reference, preview and quote digest to the current Genesis owner/version. These hashes do not prove artifact existence, moderation, approval or generation. A changed preview has a different binding; fulfillment must obtain fresh approval and independently recheck owner/version. No image is applied by this foundation.

`inspectProgressionMetadata` replays the existing `prepareProgression` and `applyVerifiedProgressionDraw` reducers against one or two locked Season assets. It checks the retained result shape and exact participant effects. A caller-supplied committed-looking receipt is never authenticated here: every result explicitly says structural compatibility, unverified receipt authenticity and no authorization. A future repository must establish committed receipt/effect lineage, entropy provenance, current versions and absence of holds. This module does not accept manual outcomes as production fairness.

`inspectMetadataTransfer` checks preservation of lifetime reroll count, cooldown, traits and expiry. Pending locks are not cleared. It is a shape check, not a transfer observation importer.

The permission/recovery dossier records unresolved external-burn, burn-veto removal, unreachable update-authority, permanent-delegate and asset/collection custody conflicts from `platform/lab/CORE-VAULT.md` and `platform/validation/protocol-status.md`. An unsigned B15 plan cannot override them. Historical allocations/claims and every image revision must be retained; restoring media requires a new authorized revision.

All inputs are bounded data-only structures (32 KiB outer input, 16 KiB asset JSON, 4 KiB slot JSON). Getters, unknown fields, duplicate JSON properties, sparse arrays and malformed identities are rejected. Financial state is always `not-applicable-local`; signing, broadcast and financial execution are unavailable.

This is B17 step4/6 groundwork only. Fairness disclosure projection and the recoverable refresh proposal workflow remain separate work. No provider, custody configuration or metadata mutation route is selected.
