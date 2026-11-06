# Bounded historical stage publication audit

`auditLegacyStagePublication(input, ports)` verifies a retained publication
preimage against the old `publishCollectionStage` terms hash and the scalar
output of the existing `publishStage` reducer. It is a pure audit preparation
helper. It does not publish, activate, mutate SQL, create an accepted receipt, or
establish chain provenance. Missing original inputs return a named `held` result.

## Retained facts

The `legacy-stage-publication-preimage-v1` header contains the original committed
inventory/stage identity, type, three times, lamport amounts, allocation,
**pre-normalization walletLimit**, founder approval, approved spend, ballot and
rationale, plus the ID of an existing sealed035 wallet list. All keys are explicit.
Null wallet limit and false approval represent the old nullish defaults; they
must come from the retained original preimage, not the current stored stage.
Genesis/free normalization to walletLimit1 cannot recover a lost original value.

The header commits the canonical wallet array used by the old hash: sorted and
deduplicated. Original raw ordering and repeated entries were discarded by the
old hash and reducer and are not claimed recoverable. Public and free publication
hashes still commit this original array even though their reducer output discards
it. An explicit sealed empty list proves `[]`; a missing list does not.

The caller supplies one bounded original035 seal, a scalar inventory header,
at most31 prior stage projections, and the current stage's scalar terms and
membership descriptor. Later-tranche first publication also requires the prior
tranche opening and matching historical ballot reference. These must eventually
come from the same guarded source snapshot. No finalized flag or current stage
value can replace missing original publication input.

## Exact comparisons

The helper preserves the old **ordered JSON tuple**, including `{$lamports:...}`
wrappers and null fields. It independently verifies the seal's closure digest,
manifest content ID, streamed count, global ordering, first/last wallets and
complete wallet-array digest before accepting the old terms hash.

Scalar comparison covers id/type, publication/open/close times, price, allocation,
normalized wallet limit, optional approved spend, creation cost, terms digest,
ballot and rationale. Absent/undefined approved spend normalizes to the absent
JSON property produced by the legacy store. Raw state bytes/property order are
not rewritten or audited here; the separate raw-state audit retains that identity.

The pure reducer receives an isolated empty wallet sentinel to derive scalar
fields. Inspection and reference-store tests establish that wallet contents only
affect the reducer's wallet output; that output is discarded. Whitelist/founder
membership is separately required to name the exact original sealed list and
commitment. Public membership must remain unrestricted. Free membership may be
pending or reference a later cut and always returns
`separate-free-cut-audit-required`. A later cut is never substituted into the
original publication hash or certified by this audit.

## Resource and trust contract

Inject a fresh trusted native SHA-256 writer with `write`, `finish`, and `abort`.
The existing Node/Worker recovery digest adapters implement that port; this
module imports neither runtime implementation nor an optional hash package.
Two incremental streams hash the old tuple and the original wallet array in
parallel. Failures abort both; no prefix can produce a successful result.

`readWalletChunk({listId, offset, limit:1000})` returns only that named immutable
list, its exact offset, at most1000 wallets and an explicit terminal flag. At most
ten calls process the legal10000-wallet list. No runtime full-list clone, array
sort, or full inventory hydration occurs. The helper measures serialized working
payload, holds above1MiB, and bounds captured metadata to64KiB. These measurements
are not JavaScript heap claims.

The focused maximum fixture uses the actual035 intake/seal and038 immutable
indexes:10000 members,100 pages,10 SQL chunk reads,1000 maximum returned rows,
276657 maximum measured serialized working bytes. Total bytes fed to both hash
streams plus metadata hashes are954818. SQL setup/import is outside the audit.

The future repository must verify actual immutable raw/index/seal linkage, total
membership and source identity, enforce at most64 SQL operations for the whole
stage audit including metadata/fences, and recheck the source watermark/revision
before persisting a compact result. This pure helper does **not** establish those
SQL completeness/fencing properties from an unguarded reader. Worker adapter
integration, durable audit persistence and activation are not implemented here.

Noncanonical historical input types outside this typed contract remain held;
they are never coerced into a guessed preimage. Source fixtures remain explicitly
local and synthetic. No payment, sale, custody or financial authority is implied.

Run `node --test platform/collect/legacy-stage-audit.test.mjs` for reference-store
parity, normalization collisions, missing preimages, original/free-cut separation,
maximum indexed-list hashing, input mutation and native-stream failure cases.
