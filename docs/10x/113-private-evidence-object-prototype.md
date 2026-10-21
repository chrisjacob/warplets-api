# Private selective evidence objects

22 October 2026 (Australia/Sydney). Advances the individually addressable evidence step in [101 — storage capacity](101-compressed-archive-and-free-capacity.md), using a frozen archive. This is an offline preservation and lookup prototype. F5 remains partial: live-store relocation, encryption, private runtime authorization, affordable serving and Free capacity acceptance remain open.

## Implemented

`scripts/discovery-evidence-objects.mjs` exports the complete holder and wallet evidence tables from an independently pinned, verified archive into a new private directory. It uses existing Node facilities and Zod; no dependency, provider request, bucket, paid service or Worker binding is added.

Run from the repository root, retaining pins independently:

```powershell
node scripts/discovery-evidence-objects.mjs pack ARCHIVE SOURCE_MANIFEST_SHA256 NEW_PRIVATE_DIRECTORY
node scripts/discovery-evidence-objects.mjs verify OBJECT_DIRECTORY CATALOG_MANIFEST_SHA256
node scripts/discovery-evidence-objects.mjs lookup OBJECT_DIRECTORY CATALOG_MANIFEST_SHA256 TABLE ORIGINAL_PAYLOAD_HASH NEW_PRIVATE_JSON
pnpm test:discovery-archives
```

Only `tenx_holder_evidence` and `tenx_wallet_evidence` are exported. Original payload text is stored as individually gzip-compressed objects named by raw-byte SHA-256. Equal payloads can share one object while retaining separate row metadata and hashes. The catalog preserves original keys, addresses, slots, observation times, column order and SHA-256 of each complete reconstructed row, plus the original archive manifest and pin. It does not copy session values or other tables; the full database archive remains recovery authority.

Source verification checks the original database hash, SQLite integrity, foreign keys and inventory. Extraction uses a read-only transaction and rehashes the source afterward. Every exported row is reconstructed and verified before the final catalog completion marker is written. Catalog population counts must match both complete source table inventories; missing rows, duplicate identities and orphan objects fail.

All SQLite TEXT columns are read as raw bytes and strictly decoded as UTF-8. This avoids Node SQLite's ordinary text conversion truncating embedded NULs. BOMs, NULs, Unicode, empty strings, original numeric notation and even invalid JSON text survive exactly; the tool does not reinterpret payloads or metadata. Invalid UTF-8, unsupported column layouts/storage types or unsafe metadata hold rather than being normalized or silently omitted.

Verification checks the independently retained catalog pin, embedded source manifest, compressed size/hash, bounded decompression, exact raw size/hash and complete row hash. These hashes identify retained bytes relative to trusted pins; they do not authenticate an unknown publisher, prove market truth or certify scoring evidence. Existing source/schema/time/economic/election/action/financial gates remain necessary.

Selective lookup validates the entire bounded catalog metadata but reads and decompresses only the requested object. It verifies that row's original hash, returns `objects_read: 1` and `other_objects_verified: false`, and can operate without the source archive or unrelated object files. A missing unrelated object still fails full verification. Lookup is not full-pack certification, freshness validation, an indexed runtime implementation or permission to act. CLI row contents go only to a new private JSON file; stdout contains aggregate hashes/counts.

## Bounds and privacy

- Inputs and outputs resolve inside ignored repository `.tmp`, outside `.wrangler`; links and Wrangler junction aliases are refused. Destinations must be new and have existing parents. Exclusive creation prevents overwrite; partial failures remain without a completion marker. No evidence deletion, activation, live migration, collector restart or counter reset occurs.
- Source archive, logical payload population and aggregate compressed objects each have a 2 GiB bound; each raw payload is at most 2,000,000 bytes. The catalog is at most 16 MiB with at most 10,000 rows/objects. Packing and full object verification have five-minute loop deadlines after initial source verification. Decompression cannot exceed the declared raw length. These are offline format bounds, not new research restrictions or changes to provider budgets.
- Compression is **not encryption**. Catalogs contain private addresses and metadata; objects contain private research. Keep all outputs ignored and private, outside served assets. Owner-only file/directory modes are requested; Windows ACL enforcement is not certified. No upload or public endpoint exists.
- This format does not solve live D1 allocation, full-store recovery or Worker request CPU. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [R2 limits](https://developers.cloudflare.com/r2/platform/limits/) are separate constraints; published allowances do not establish account entitlement, unused capacity or no-spend controls. No remote service is provisioned.

## Frozen-snapshot result

The source is the existing 83-table / 39,408-row archive from `2026-10-21T14:24:50.571Z–14:25:01.519Z`, not today's newest store or a multi-day growth sample.

| Measurement | Result |
|---|---:|
| Holder / wallet rows | 885 / 73 |
| Exported rows / compressed objects | 958 / 958 |
| Duplicate payload references | 0 |
| Original payload bytes | 925,125,445 |
| Compressed object bytes | 167,213,875 |
| Catalog bytes | 665,601 |
| Total pack bytes | 167,879,476 |
| Reduction versus original payload bytes | 81.85% |
| Independently matched complete original row hashes | 958 / 958 |

An independent read-only check reconstructs every original row directly from source SQLite bytes, comparing both complete row and raw payload hashes against the catalog. The original full database hash remains identical. No duplicate payloads occurred in this sample: measured savings come from compression, although deduplication is fixture-tested.

Full local object verification took 9.23 seconds. Six first/last/largest-row probes across both tables read one object each, 5,364–367,039 compressed bytes, with local elapsed times of 21.92–47.62 ms including catalog validation. These are local Node filesystem observations, not remote latency, billed CPU, true storage-cold performance or Free hosting acceptance. Lookup still parses all catalog metadata.

Retained pins:

| Artifact | SHA-256 |
|---|---|
| Original archive canonical manifest | `a8265797af92c538a481e7074a87c317668da0125e92536732d7b61f1e1e99aa` |
| Original SQLite file | `40f45fa51b9e5287b2ee44dfb98c094b414504d25a69984b2a24ee5dc2fbf2ec` |
| New catalog canonical manifest | `207372536ffc586ced760196e6d45213de258f27d5f731ce4cf3720bdaef3c3f` |
| Independent proof file | `78e9cfb6c97c63f4393f54689daee790f372e91cd89cfea7059960ef01f4f6e7` |

Private artifacts: `.tmp/discovery-evidence-objects-20261022-001/{objects.json,objects/}` and `.tmp/evidence-object-proof-20261022-001.json`. Canonical manifest pins hash the serialized manifest body, not the pretty-printed file bytes. Keep the original archive and full compressed backup; this subset cannot replace them.

## Verification and next work

**28 archive tests pass:** the existing ten full-archive and seven compression tests, plus eleven selective-object tests. New cases cover exact original rows/BOM/NUL/Unicode/empty text, deduplication without session copying, source independence, selected-only lookup, exclusive outputs, wrong pins, compressed/raw/row corruption, repinned truncation/expansion bounds, missing/duplicate/orphan records, unsafe metadata, oversized or unrepresentable sources, schema drift, Wrangler/junction/file links and private CLI exports. Security CI now runs this command; a hosted run is not claimed.

Node syntax, original live evidence hash/foreign-key preservation, actual-key exclusion from changed sources/built assets and decoded private objects, security preflight and the existing built thesis-only assertion are checked separately. Application runtime code, scoring, schemas, migrations, dependencies and UI did not change; application builds and unrelated suites are not repeated for this offline tool.

Next implement the private encrypted object/index design and verify existing Free entitlement, authorization and no-spend controls before any remote use. Measure a scratch compact metadata/index database's real allocation, complete row overhead, indexed read/write costs and growth. A future runtime evidence resolver must preserve original hashes and old cohort/election replay, followed by stopped-owner adoption, rollback and off-device recovery tests before any live relocation. Multi-day retention and account-wide serving/maintenance costs remain open. Continue broad unfamiliar-token F1 and economic-participation F3 qualification under existing admission rather than adding unapproved source traffic.

V4, all evidence/action/election/financial gates and production thesis-only closure remain unchanged. Public/automatic experimental serving adoption stays held. No deploy.
