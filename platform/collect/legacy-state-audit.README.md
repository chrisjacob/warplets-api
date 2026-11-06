# Canonical source projection audit

`createLegacyStateAudit({crypto, hash, readRecord}).step({rootId, checkpoint})`
reconstructs the exact035 canonical state transcript using bounded immutable
records. Start with a null checkpoint. Persist and reuse a returned continuation
only through a future private guarded repository; this module itself is pure and
does not persist or activate anything.

Each invocation verifies the named root again using the shared035 defensive
record validator. It reads at most one additional list manifest and one page.
Record byte IDs, canonical bytes, known shapes, indexes, partition/count rules,
global wallet order and complete list digests must match. Unknown stage terms
hold. The result independently compares the final digest with
`root.source.stateDigest`.

The emitted object follows canonical key order:

1. Admissions, preserving page order and each entry's exact canonical JSON.
2. Inventory scalar keys before `stages`.
3. Each stage's bounded known terms, followed by `wallets`. Public and pending
   free lists emit null. Explicit lists emit one100-wallet page per continuation
   into both the main hash and an independent list hash.
4. Inventory keys after `stages`, preserving omitted versus explicit-null tranche.

BigInt lamport wrappers and Unicode remain unchanged. A raw legacy JSON string
with a different property order has a different raw byte identity; that separate
identity is not certified here. Pending admission records are preserved as data
and are not approved for migration or minting.

## Checkpoint trust and bounds

Checkpoints carry exact versioned fields, root ID, phase/cursors/counts, the last
wallet, main/list hash state, emitted-byte count and a digest over the checkpoint.
Malformed cursors, byte-count inconsistencies and altered integrity digests hold.
The checkpoint digest is **not authentication**. A caller can compute another
digest; structural hash validation cannot prove that later compression words
represent a reachable source prefix. Durable private CAS persistence must bind
the authentic checkpoint chain and source-generation/header/watermark before any
application can consume the result. No caller-supplied checkpoint is authority.

The injected hash is the pinned B11-24 resumable adapter at trusted runtime
composition. Every emitted fragment is at most65536 bytes; the transcript is
bounded to32MiB; checkpoint JSON is at most4096 bytes. Measured serialized working
payload is bounded to1MiB per step, including record/canonical/hash copies. This
is not an engine-heap measurement. No runtime full state or wallet list is loaded,
and no optional hash package is statically imported into reference modules.

The reference tests use an explicitly test-only native `createHash.copy` cache
to verify transcript construction. Its state is not serializable between
processes and is rejected by the production pinned-state validator. The actual
D1 test reconstructs Node and workerd services and pinned adapters for every
invocation, comparing all returned checkpoint words and final results. Its named
records come from real035 intake receipts and retained table rows.

## Acceptance and remaining work

Focused cases cover empty inventory/list, shared and distinct lists, pending and
fixed free membership, optional/null fields, Unicode/amount wrappers, original
raw versus canonical identity, altered declared digest, missing/wrong/reordered
pages, wrong count/list digest, cross-page duplicates, source identity/revision,
checkpoint mutation, retry, interrupted reads and asynchronous caller mutation.
The capacity case includes32 distinct10000-wallet lists and1000 bounded admission
records with maximum scalar lengths, comparing the resulting transcript with the
existing offline codec. Full materialization is confined to those test fixtures.

```
node --test platform/collect/legacy-state-audit.test.mjs
node --test platform/collect/legacy-state-audit.capacity.test.mjs
node --test platform/edge/test/legacy-state-audit.test.mjs
```

A verified result is labeled `projection-digest-only`, with
`rawSourceRelationVerified:false`, `economicsVerified:false`, and
`adoptionAuthorized:false`. It proves neither equality to the current legacy SQL
row nor eligibility/approval, mint outcomes, historical ownership or economic
correctness. The bounded source-to-SQL relation audit, raw-byte audit, component
audits, guarded durable persistence and final authority activation remain
separate work. No public audit route, schema, financial execution or external
provider operation is added here.
