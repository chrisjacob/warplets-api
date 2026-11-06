# Private legacy audit hash prerequisite

This slice supplies a pure injected adapter and fixture-only Node/workerd tests.
It does not activate adoption, introduce tables, install dependencies, or expose
request-driven hash state as authority. The constructor is pinned to the already
installed @noble/hashes 2.2.0 implementation and its four exact source file hashes.
The reference tests contain no static package import. Optional genuine-library
acceptance is under the edge test suite, after pinned dependencies are present.

The private port exposes initial(), advance(state, chunk), finish(state). Advance
accepts 1..65,536 bytes and returns a fresh immutable state; source size is at most
33,554,432 bytes. State has exactly format, algorithm, implementationPin, bytes,
words and tailHex. Eight unsigned 32-bit words represent complete blocks; the
lowercase hexadecimal tail is exactly bytes%64 bytes. Before the first full block,
the words must equal the SHA256 initialization vector. Unknown fields, wrong pins,
unsafe counts, malformed words and impossible tail lengths fail closed. A fresh
pinned instance receives the validated state; all remaining buffer bytes start at
zero. Each instance is destroyed after advance/finalization. Digests preserve the
original raw byte preimage, including JSON field order and BigInt wrappers.

Structural validity does not prove reachability of arbitrary state after a full
block. The future application must never accept a state object or claimed digest
from a public request/import as proof. Only a private audit repository may load a
prefix it produced in an earlier guarded step. Runtime composition must pin the
constructor; the state pin is not runtime attestation of arbitrary injected code.

Proposed future immutable source envelope:

- Source identity: inventory ID, original source/preimage component kind, exact
  raw byte count and independently retained expected digest.
- Frozen source identity: immutable staged-root/object descriptor plus exact
  source revision/generation. Mutable database exports require a fenced capture
  before auditing; hash continuation cannot make a changing source consistent.
- Audit identity: algorithm/implementation pin, audit generation, component ID,
  exact ordered page descriptors or source object and authorized operator scope.
- Durable prefix: next byte offset, hash state, prior accepted step/receipt ID and
  state digest, cumulative page/chunk closure, original source-envelope digest.

Each future audit step reads only a bounded next chunk from the retained source,
checks exact offset/length/hash against its descriptor, and CASes the old cursor,
source identity and audit generation while storing the next state and receipt.
Duplicate delivery replays the same receipt; changed input conflicts. Metadata
writes must not invalidate their own frozen source revision, but must advance the
recovery watermark and retain immutable provenance. Independent unrelated writes
must not silently redefine a captured source. Finalization requires byte count,
full expected raw digest and every component/economic check before activation.
These durable guarantees are a proposal, not implemented authority in this slice.

Initial adoption should remain quiescent and component-bounded: no pending legacy
progression/draw locks; original terms and fairness preimages available; exact
admission outcomes, fixed slots, ownership/reveal history and Vault liabilities
preserved. Original receipts are retained; normalized 045/046 receipts are never
fabricated for historical operations. Missing original inputs remain held.


Validation uses 12 byte lengths, including padding/block boundaries and 32 MiB,
with JSON serialization and fresh hash instances between every chunk. The largest
case uses 522 separately dispatched Worker steps and matches Node native SHA256.
The longest serialized state in these vectors is 435 bytes. The source bytes in
this acceptance are explicitly synthetic; it does not establish real inventory
source completeness. Fixture setup verifies the exact installed source hashes
before bundling the same pinned implementation for workerd. The source manifest
is legacy-audit-hash-sources.json. No package installation or lockfile changed.

```text
node --test platform/collect/legacy-audit-hash.test.mjs
node --test platform/edge/test/legacy-audit-hash.test.mjs
```
