# Bounded legacy source relation

`createLegacySourceRelationAudit({driver,crypto}).step(...)` compares a retained
legacy `collect_inventories.state` JSON document to named immutable 035 records.
It reads one admission partition or wallet partition per continuation, and
keeps the original JSON document inside SQLite. Maximum source size is 32 MiB;
each step is limited to 64 SQL statements, a 256 KiB SQL batch and a conservative
1 MiB serialized working estimate. Current implementation uses at most three
named records in a step. Checkpoints are at most 8 KiB.

The first step binds inventory header, generation and whole-business watermark.
Every step verifies requested record identity, SHA-256, canonical record bytes
and record shape. Top-level scalar fields, ordered admission entries, ordered
stage scalar terms and ordered wallet pages must match exactly. Membership here
means the **current retained stage membership**; original publication membership
and original terms preimages are the separate legacy-stage audit's concern.
Unknown or duplicate keys, including admission and amount-wrapper duplicates,
are rejected before JSON normalization. Missing and explicit null remain distinct.
SQLite `real` number spellings such as `1.0` are held conservatively, even when a
JavaScript parse would produce the integer `1`.

The final pin check runs after all asynchronous record/checkpoint/result hashing.
A mutation of any watermarked business table, generation or inventory header
invalidates the continuation. Lost read responses can retry the same checkpoint;
the adapter performs no database writes. Scalar cell aggregation is limited before
hydration, so repeated known keys cannot create an unbounded result.

The verified-root helper returns only cloned header/scalar facts, counts,
eligibility kinds, admission page IDs and the current stage. Its complete parsed
root, encoded SQL row and byte buffers leave scope before component SQL starts.
The component helper owns page and comparison buffers; those leave scope before
the final checkpoint/result hash. Admission queries request precisely the named,
verified page's entry count, including pages whose 64 KiB bound yields fewer than
100 entries.

`resultBytes` remains the sum of **every** returned batch. Working measurements
use separate root/component/final lifetime peaks and retain the original
conservative three-copy multiplier for live returned data, checkpoint, selected
facts and comparison data, plus 16 KiB fixed overhead. `phasePeaks`,
`retainedFactsBytes` and `maxResultBatchBytes` expose the calculation. This is a
serialized live-data bound, not a claim about JavaScript GC timing or process RSS.

Successful output is `source-components-equal-legacy-json`. Its
`declaredStateDigest` is a reference, not a verified digest. Canonical digest,
raw-byte digest, economics and adoption flags remain false. B11-26 and B11-28
provide the separate canonical-transcript and raw-byte checks.

This adapter is a private read primitive, **not an authorization boundary**.
Checkpoint hashes detect corruption; they do not authenticate a caller-created
prefix. A future guarded repository must persist authoritative prefixes with
owner/CAS checks and validate exact schema and trigger fingerprints. D1 rejects
`schema_version`, so this adapter deliberately has no schema-cookie assertion.
No source completeness, chain ownership, operator approval, publication or
economic activation follows from these read results.

Tests use explicitly synthetic legacy JSON and real retained 035 intake rows.
The Node maximum graph is 32 distinct 10,000-wallet lists and 1,000 admissions.
Actual D1 tests compare serialized continuations against Node, with genuine SQL
reads and digest-await mutation injection; these tests expose only a private
fixture route. No remote reads, resource mutation, public audit route or financial
execution is introduced.

The B11-30 baseline maximum Node graph used 3,248 steps and at most six SQL
statements per step, a 2,031-byte SQL request batch, 275,758 cumulative returned bytes across separate
read batches in a step, and 1,041,262 bytes of conservative working data. The
256 KiB SQL batch bound applies to requests; cumulative returned bytes are
separately included in the 1 MiB working guard. Only 7,314 bytes remain below
that working ceiling. B11-34 addresses that retained-buffer constraint, but
integration must still measure the whole durable repository wrapper before
claiming its complete budget fits.

The final B11-34 maximum graph preserves all 3,248 steps, 3,245 retained records,
320,000 wallet occurrences and 1,000 admissions. Working peak is **738,772 bytes**
(root 302,890; component 738,772; final 32,164), with at most 3,560 retained fact
bytes. Cumulative returned bytes peak at 265,056 per step; the largest individual
result batch is 91,283 bytes. The full run passed in 252.3 seconds including
99.3 seconds of real 035 fixture intake. The actual D1 test with byte-bounded
admission pages peaks at 739,456 bytes. Both leave over 300 KiB of measured core
headroom; complete guarded-wrapper measurement is still required.

That baseline maximum run preceded removal of the unsupported schema-cookie scalar;
removing that one pin field reduces serialized data and does not change compared
components or SQL partitions. Final focused Node and D1 checks cover the resulting
pin shape. Full maximum graph D1 execution has not been established.
