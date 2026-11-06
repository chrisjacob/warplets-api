# Continued private capture

This local B11 slice adds private v2 **capture**. The existing v1 exporter,
inventory format, restore implementation and limits are unchanged. Continued
v2 private restore and target reconciliation are implemented in [V2_RESTORE.md](V2_RESTORE.md).
A capture pin alone is not a completed restore or a claim of B11 completion.
No public route, operator web route, scheduled export, production resource or
financial capability is enabled by these modules.

`createRecoveryV2Capture` takes the existing atomic driver, ArtifactStore,
manifest codec, injected crypto/clock, trusted installed migration descriptor
and `createRecoveryV2Codec`. Its private methods are:

```js
const started = await capture.start({captureId, sourceCommit});
const next = await capture.step({captureId, expectedRevision: started.revision});
// Repeat one bounded continuation at a time, retaining the returned revision.
// A captured result contains {value, bytes, digest}; retain digest independently.
```

`finish` succeeds only after every graph object has been verified. Accepted
start/continuation retries preserve the original capture identity; a completed
capture returns its original bytes and digest. Lost acknowledgements reread
durable revision state. Unknown object writes or missing/corrupt retained bytes
leave the cursor unchanged for an exact retry. Omitted row, reference or index
ledger children cannot advance the corresponding checkpoint.

Before reading application data, startup compares actual `schema_versions`
names with the trusted migration inventory and verifies the complete canonical
SQL of every expected watermark trigger and all three watermark guards. It
also retains bounded exact table definitions. D1 forbids `schema_version`, so
commit fences compare the actual table/trigger SQL and migration names in both
directions against that frozen descriptor. Verified common watermark templates
compress the descriptor without replacing exact SQL comparison with names or
lengths. A same-name disabled trigger, including one substituted while a page
is being hashed, cannot authorize a capture.

Each data-page read and final metadata/CAS write require the same source
generation, schema and whole-business watermark. Live source writes remain
enabled. A change before source sealing holds that capture; start a new capture
ID to read the new state. Source writes after sealing are allowed because every
later step reads only immutable captured pages. Authentication rows and recovery
control tables are excluded from business pages. New business tables require
their watermark triggers before startup can succeed.

The captured table graph includes all declared business tables, their exact
column/key metadata and every row. Pages use keyset cursors, at most100 rows
and128 KiB, except collection source-record pages permit192 KiB. A row that
cannot fit causes a hold; it is never skipped. The oversized legacy single-row
collection inventory remains unsupported until its separate normalization and
adoption work is complete.

Private artifact references and publication staging chunks are extracted from
the sealed pages. Public archives are reverified against both exact byte SHA-256
and legacy semantic commitments; their independently verified pins remain
distinct from private metadata. Each reference step processes one object.
No external provider or ownership completeness is inferred from these bytes.

Indexes are canonical immutable private JSON, built with16-way fanout (codec
ceiling100) and at most8 levels. The table index commits each table descriptor;
each table descriptor commits its page index; object and publication indexes
retain the remaining references. The object catalog omits index nodes to avoid
self-reference: those nodes are reachable through the root and branch pointers.
Intermediate descriptor/pin objects are included in the object catalog. Root
totals count all unique reachable objects, including metadata, and exclude the
root document itself. A final continued pass re-reads every object before the
root is made immutable.

V2 aggregate bounds are65,536 rows per table,128 tables,16,384 unique objects
and128 MiB. These limits never authorize aggregate hydration. Calls are measured
against64 combined SQL/object operations and1 MiB serialized working data;
verification of one public archive up to2 MiB has a dedicated4 MiB ceiling.
Atomic SQL batches retain the existing256 KiB/100-parameter limits. The pinned
root is at most256 KiB. All test fixtures remain explicitly synthetic.

```text
node --test platform/recovery/v2-codec.test.mjs platform/recovery/v2-planning.test.mjs platform/recovery/v2-watermark.test.mjs platform/recovery/v2-traversal.test.mjs
node --test platform/recovery/v2-capture-source.test.mjs platform/recovery/v2-capture-references.test.mjs platform/recovery/v2-capture.test.mjs
node --test platform/recovery/v2-capacity.test.mjs platform/recovery/v2-maximum-source.test.mjs
node --test platform/edge/test/recovery-v2.test.mjs
```

The capacity cases stage actual SQL data through the guarded commands. One has
10,000 electorate members and10,000 votes; the other retains32 distinct10,000
member lists,3,245 raw records,3,200 private eligibility index pages, all command
receipts and1,000 declared admissions. The latter is a verified record closure,
not activated economic inventory or a claim of chain provenance. Fresh-target v2 restore acceptance for both graphs has passed; exact evidence
and remaining oversized-row limitations are documented in V2_RESTORE.md.
