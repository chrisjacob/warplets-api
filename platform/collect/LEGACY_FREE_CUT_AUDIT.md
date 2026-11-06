# Private legacy Season free-cut preimage audit

`legacy-free-cut-audit.mjs` checks one retained original snapshot in bounded continued steps. It reconstructs the exact old `freezeSeasonSnapshot` hash preimage and checks that its eligible-wallet union equals the selected immutable 035 list. It does not activate an inventory, authorize an admission, attest a chain snapshot, or establish historical ownership or known-local-asset completeness.

The result explicitly carries `verification: 'original-preimage-and-wallet-projection-only'`, `knownLocalCompletenessVerified: false`, `historicalOwnershipVerified: false`, `authoritativeFreeCutFact: false`, `adoptionAuthorized: false`, and `executable: false`. It cannot be passed to the B11-31 economic audit as an authoritative free-cut fact.

## Original bytes and compatibility

The old digest is SHA-256 of the old JSON serialization of `[inventoryId, stageId, at, sourceRef, holdings]`. Holdings are sorted by asset ID, with insertion order `{id, owner, collection, level, revealedAt}` and null defaults for absent Level/reveal fields. The old BigInt wrapper remains `{"$lamports":"..."}`. Nested JSON order in ignored fields is preserved. Generic canonical JSON would change this preimage.

The old policy ignores Level/reveal values on unrelated collections, and ignores Level on unrevealed or future-revealed Genesis holdings. Some such originals are valid legacy inputs but invalid under the stricter 047 codec. Separate `legacy-free-cut-page-v1` pages retain those originals. Scalar-compatible 047 pages may also be referenced; their page/root hashes are transport identities, never substitutes for the old flat snapshot hash. A new `legacy-free-cut-transcript-v1` manifest binds page order, byte identities, ranges and counts. The offline encoder is only a fixture conversion convenience, not a source attestation.

At most 10,000 holdings, in pages of at most 100, are supported. Raw legacy pages must fit 64 KiB. A larger historically valid ignored-JSON page is an explicit compatibility hold; this slice does not rewrite it or enlarge active collection limits. Missing original bytes hold even when current assets or a newer cut could produce the same wallets.

## Continued phases and trusted state

1. Read and verify the 035 source root, select the exact Season free stage/opening/list, and discard the full root before retaining the selected scalar facts. Bind the retained `collect_snapshots` row and original transcript manifest.
2. Verify every fixed-list page, global wallet ordering, and exact sorted-array digest in continued list steps.
3. Hash one original holding page and compute its eligible wallets using the unchanged legacy policy.
4. Resolve at most 32 wallet locators. The lookup supplies only page indices and offsets. Sequentially read, hash, check and release each referenced list page; no group of 32 page bodies is retained. The earlier list phase proved full canonical shape; the same content ID proves those bytes again. Set positions in a bitmap to deduplicate wallets across pages.
5. Require all holdings and every fixed-list position to be covered, then compare the old flat digest. An extra fixed-list wallet, missing eligible wallet, contradictory locator or changed page holds.

The injected B11-24 hash adapter is recreated on every invocation. Only a private durable checkpoint emitted by a previously guarded step may resume. Structural validation and the checkpoint checksum cannot prove that arbitrary SHA words or bitmap state are reachable. A future guarded repository must bind the source generation/revision, selected snapshot/list/transcript identities and cursor before and after each asynchronous step and persist the prefix with a compare-and-swap. This pure component does not implement that authority boundary. Failed steps leave the previous checkpoint unchanged and can restart from it.

## Bounds and evidence

Each step allows at most 64 named record/lookup operations, 16 KiB checkpoint JSON and 1 MiB conservative serialized working payload. A 10,000-wallet bitmap is 1,250 bytes. Individual caps are 128 KiB source root, 32 KiB transcript manifest, 16 KiB list manifest, 8 KiB list page and 64 KiB original holding page. Working accounting includes captured input/checkpoint, phase metadata, serialization/decoding/hash copies, lookup locators and bitmap; it is not a JavaScript heap profiler. Database lookup execution cost still requires the future concrete repository's query plan and frozen-source guards.

The reference suite uses actual legacy snapshots and 035 conversion, including empty cuts, ignored nested JSON, 047-compatible pages, wrong digests/order/locators, caller mutation, interruption/replay, and 10,000 holdings. The actual D1/R2 fixture stages real 035 records and eligibility indices, uses the installed pinned noble adapter freshly per call, and compares every continued result with Node. Fixture loading is explicitly offline setup; it is not a runtime ingestion contract. No public route is mounted.
