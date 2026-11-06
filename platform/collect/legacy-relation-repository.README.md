# Durable private legacy relation

`createLegacyRelationRepository({driver,crypto,clock,ids,onMeasure?})` persists
the bounded B11-34 relation prefix in the excluded 051 control table. Its only
inputs are:

- `start(operator,{auditId,fingerprintAuditId})`
- `step(operator,{auditId,expectedRevision})`

The caller cannot supply a checkpoint, source digest, root, result or proposed
summary. The parent must be a genuine `fingerprints-ready` 050 audit owned by
the same currently scoped `collection-import` operator. A parent has at most
one relation child. The retained root must still have committed 035 staging
and source-seal receipt lineage.

Each insert, prefix CAS and ready read checks the parent source revision,
generation, whole-business watermark and exact schema/trigger fingerprint in
SQL. The large parent descriptor stays inside SQLite. Only bounded IDs,
digests, source generation/watermark and private control fields reach JavaScript.
The unchanged pure relation result must match the parent root, inventory,
canonical digest and frozen pin. Migration 051 independently rejects missing
results, wrong counts/identities, null/non-hex relation digests and premature
verification flags.

CAS binds owner, parent, old revision, old checkpoint, old result and old nonce.
A fresh nonce plus positive write changes identifies the winning attempt;
the retained row is always re-read before reporting success. Zero/unknown
changes with a valid newer durable row return replayed state. This preserves
accepted work after lost acknowledgements and prevents identical generated
nonce races from reporting two writers. A missing write leaves the original
prefix intact. Ready and held rows are immutable.

`relation-ready` combines the parent's raw and canonical fingerprints with the
verified component relation. It returns `sourceRelation:true`, while
`economics`, `adoption` and `executable` remain false. It does not establish
historical stage approval, admission/fulfillment provenance, chain ownership,
complete economic validity or active collection authority. Source changes,
scope loss, schema changes or replacement generation make an old ready result
unavailable. Private controls do not advance the business watermark and are
excluded from recovery exports; a restored source requires a fresh audit.

The wrapper measures its control copies, candidate/result copies, SQL request
and readback data alongside the core's conservative phase peak. The limits
remain 64 statements, 256 KiB per SQL request batch and 1 MiB serialized working
data per call. These are live serialized-data measurements, not process RSS.
Tests cover genuine Node and workerd/D1 parent workflows, maximal scalar/root
and admission partitions, real CAS races and failures at the SQL boundary.
The full 32-by-10,000 membership comparison remains the separate B11-34 pure
graph evidence; this slice does not claim a full maximum durable walk.

Installed-051 acceptance measured 180 Node calls over 32 maximal scalar stages,
1,000 maximal admissions and one 10,000-member list: peak 759,869 bytes including
the wrapper, at most nine SQL statements and a 5,669-byte SQL request batch.
Actual D1 measured 759,860 bytes, nine statements and a 5,662-byte request batch
over the corresponding maximal admission/root phases with a 101-member list.
Separate actual D1 cases mutate scope, source and schema after computation and
verify the final CAS cannot advance. These measurements include private control
and SQL readback overhead; they introduce no larger runtime limits.

No public route, deployment, external provider call or financial execution is
introduced. Worker routes in the acceptance fixture are private and explicitly
synthetic; the pinned SHA implementation is imported only by that fixture.
