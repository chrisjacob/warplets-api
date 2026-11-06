# Retained synthetic collection observations

`createCollectionObservationService({repository, crypto}).observe(principal,
input)` is a private operator command requiring the `collection-evidence` grant.
The caller supplies a request key, asset, event kind/time, from/to wallets,
expected asset version, B04 receipt digest and raw-byte digest. It cannot supply
finality authority, asset state, revealed traits or a success flag. Public
observation routes remain unmounted.

The registered `synthetic-collection-observation-v1` source has an exact
`{inventoryId, assetId}` policy and `collection-asset` subject. Its raw JSON is
bounded to 16 KiB and explicitly labels synthetic fixture evidence. The B04
decision validates the retained event transcript; it never asserts complete
chain history or actual chain ownership. The repository requires the current
verified B04 head and committed receipt, reads the private artifact, and
independently verifies bytes, envelope, decision, source configuration and event
identity. Raw evidence is never manufactured from an unbound legacy observation.

Accepted command replay resolves first, including after grant revocation, source
change, or loss of an artifact. A new command captures revisions, grant, B04
binding, current Collect/Vault state, latest actual ownership event, and pending
operation in eight SQL statements in one read transaction. Current versions and
exact rows are fenced again with the receipt and all mandatory effects. Missing,
malformed, contradictory or future state stays pending. A missing child aborts
the entire atomic batch, including the receipt.

A reveal updates only the reveal/observed clocks. A transfer retains slot,
coordinates, traits, Level, expiry and historical allocations while changing
Collect and Vault owner together and advancing asset version. Transfer event
times retain whole-second Vault precision. A late event may predate a local
reservation only when it follows the latest actual ownership evidence; current
row clocks remain monotonic and the Vault event retains its actual event time.

An external transfer of a locally reserved participant preserves its pending
operation ID, records the observed owner and appends an immutable permanent
operation conflict. The result explicitly reports `held`. Returning ownership
adds another retained observation and does not clear the conflict. Migration
041 prevents fulfillment while any held conflict remains, including writes by
the legacy local fulfillment path. A database reservation is not a chain lock.
Conflict reconciliation and clearing require a later authorized design; this
slice cannot clear a hold.

Bound Collect and Vault observations, the evidence binding and conflict rows are
immutable. Private recovery must preserve them alongside original command/B04
receipts, pending locks and raw evidence. No transaction intents, broadcasts,
funding or claims are created. Every result remains `source: local-fixture` and
`executable: false`.
