# Recorded evidence boundary (B04)

This package validates recorded responses and stores immutable private provenance receipts in Node SQLite or local D1/R2. It makes no external provider calls and exposes no public HTTP mutation. Financial execution stays disabled. Source registration and receipt commits require the existing evidence-ingest operator scope.

## Contract and trust

`types.ts` and the `.d.mts` declarations adopt the shared EvidenceEnvelope exactly. Source mode, chain identity, decoder version and recording-manifest digest are pinned in an immutable source revision. `createRecordedReader` snapshots up to 100 recorded entries before asynchronous hashing; its manifest commits metadata and each byte digest. Readers return copied bytes. The service snapshots the result again before awaits, verifies its digest, constructs the envelope from the registered adapter, and preserves context slot, block time, retrieval time, ingestion time and requested cutoff independently.

A recording manifest is an adapter trust boundary. Operator registration is not independent cryptographic proof of RPC honesty or chain finality. A recorded-public account can be structurally verified **only as a decoder vector**; its decision always has `scope: decoder-only`, incomplete coverage and a historical-coverage gap. Missing genesis identity, block time or finalized context remains pending. Confirmed history stays provisional. Malformed/future clock facts are retained in negative receipts without substituting ingestion time. Malformed envelope structure or a reader that violates its pinned identity/byte contract fails before registration of an evidence receipt.

The genuine public vector uses the pre-existing pinned October program capture (`lab/fixtures/programs-mainnet.json.gz`, SHA-256 `4159978c9699c5ae450fff95a2c1b022ab04d38a49b2c5b4675f3dfbfa9c6296`). Existing `inspectCapture` validates its loader/ELF structures. That capture has no chain-genesis or block-time fact, so the new envelope keeps these null and its historical decision pending. No live capture was fetched. Separate SDK-derived records exercise successful raw account decoding with synthetic labels; synthetic tests of the recorded-public adapter branch are not presented as genuine captures.

## Decoder and coverage semantics

- DAMM pool, SPL mint and SPL vault bytes reuse `quotes/accounts.mjs`; only an explicit `node:buffer` import was added there. Pool sources pin program, address, both mints and vaults; vault sources pin the mint. Owner/layout/discriminator/authority checks remain in the existing decoder. Workerd tests use `nodejs_compat` to run those same functions.
- Synthetic stake valuation delegates to `pricing/policy.mjs`. Original `local-solana` labels, oracle/sample timestamps and distinct lookback timestamps remain intact. The recording context must match the pool observation; neither slot nor timestamp is rewritten to manufacture a common cutoff.
- Synthetic position histories require an explicit enrollment boundary, complete terminal page, requested end boundary, contiguous event sequence, ordered timestamps and finalized events. They check linked swap/deposit identity and amounts, and process withdrawals, exits, transfers, deposits, rewards and restakes with the existing purchase reducer. Direct external withdrawals are included. Empty pages alone never prove completeness. An explicitly complete empty **synthetic** transcript can prove an empty simulated interval.
- `runtime-read` adapters and production farm instruction layouts are deliberately unavailable. Recorded public program data cannot prove complete historical wallet activity, and no live owner/stake eligibility is asserted. B05 consumes receipt scope and coverage; a generic verified decoder receipt must never satisfy a historical coverage requirement.

## Persistence and correction

Migration026 is coordinator-owned. Source rows and evidence receipts are immutable. Every receipt references verified private bytes and its registered source revision. The stream key is canonical `[sourceId, subject.kind, subject.id, requestedCutoffMs]`; a correction must explicitly name the current receipt digest. Source revision/decoder changes require a separately registered immutable source revision and cannot change mode, chain or subject identity across the correction. Source/head revisions and exact pointer predicates are checked in the guarded D1 batch. Every child effect belongs to the exact staging nonce, and the final trigger rejects a receipt without its head.

The latest head is authoritative even when pending, incompatible or invalid: selection never falls back to an older verified observation. The old receipt remains available by immutable identity. Byte-identical retries for the same evidence identity replay one receipt. Different subjects or provenance legitimately require different receipts while sharing one content-addressed private object. Interrupted metadata registration leaves an unlisted immutable object that can be reconciled. A lost commit response recovers the stable receipt. No object enters `manifest_catalog`.

## Bounds and local invocation

Construct `createEvidenceRepository(driver, ports)` and `createEvidenceService({repository,artifactRepository,store,crypto,clock,readers})`, register an immutable source, then ingest `{sourceId,sourceRevision,recordId,requestedCutoffMs,supersedes}` with an operator principal. Keys in the injected reader map are canonical JSON of `[sourceId,sourceRevision]`. The caller cannot supply a replacement envelope mode/finality/clock. New evidence receipts use bounded retry once on an unrelated revision conflict; competing corrections require an explicit new predecessor.

Raw objects are at most 256 KiB, source config at most 64 KiB, recording sets at most 100 entries, and history at most 20 pages / 100 events per page / 1,000 events total. B02 additionally enforces SQL statement/parameter/batch ceilings. Oversized data never silently truncates into complete evidence. Local-reader counters distinguish local reads from provider attempts (always zero here). No optional transport was added; any future provider adapter must use B02 pre-attempt quota admission and B03 dispatch checkpoints before each actual call, including retries.

## Evidence commands

`node --test platform/evidence/*.test.mjs platform/pricing/*.test.mjs platform/earn/components.test.mjs platform/quotes/*.test.mjs`

`node --test platform/edge/test/evidence.test.mjs`

`node platform/edge/node_modules/typescript/bin/tsc --noEmit -p platform/edge`

Filesystem hard-link publication and workerd loopback need the same local sandbox allowance as their B02 conformance tests. A sandbox EPERM keeps the write unknown; it is not treated as successful ingestion. No credentials, remote resource mutations, program probes or external messages are involved.

## Checkpoint evidence — 6 November 2026

The combined Node command above passed 28 tests: 14 new evidence tests and 14 existing pricing/components/quotes regressions. The genuine captured decoder vector is separate from synthetic end-to-end positives. The local workerd suite passed one integrated test with D1/R2, Node/workerd decoder equality, missing-head rollback, lost-response reconciliation, duplicate replay, pending masking and competing head CAS. Edge TypeScript and owned-file diff checks passed. Tests made zero provider attempts and no remote mutations.

Coordinator review identified one replay availability defect before checkpoint: accepted ingestion originally reopened its reader before receipt lookup. It now derives stable evidence identity from immutable source config and request, then replays the original receipt before checking reader availability. A regression removes or throws the recording adapter and revokes new-ingestion scope after acceptance; the accepted result still replays without another byte read. Fresh work continues to require complete byte/provenance verification.
