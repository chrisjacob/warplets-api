# Encrypted selective evidence storage

22 October 2026 (Australia/Sydney). Implements the local encryption slice of [113 — private selective evidence objects](113-private-evidence-object-prototype.md). Both original metadata and individually retrievable payloads can now be retained in an authenticated encrypted subset. F5 remains partial: this does not relocate live evidence, provide an indexed runtime reader or certify remote Free capacity and recovery.

## Tool and format

`scripts/discovery-evidence-sealed.mjs` uses Node's existing AES-256-GCM implementation, fresh random 96-bit nonces and full 128-bit authentication tags. Additional authenticated data binds each payload to the format version, object role and original raw payload SHA-256; catalog encryption uses a separate role. Nonces must be unique across the catalog and objects within a pack. Decryption returns no data until authentication succeeds. See the [Node 22 crypto API](https://nodejs.org/docs/latest-v22.x/api/crypto.html) for the primitives; this is not a bespoke cipher or a claim of independent cryptographic certification.

The pack contains:

- `sealed.json`: a strictly validated, independently pinned outer manifest containing version, cipher and encrypted catalog size/hash/nonce/tag.
- `catalog.bin`: authenticated encrypted original catalog plus ciphertext object descriptors. Original addresses, observation times, slots, row hashes and raw object identities remain inside encryption.
- `objects/<ciphertext-sha256>.bin`: individually encrypted original gzip bytes. Nonces and tags are inside the encrypted catalog. Equal original payloads still share one encrypted object within a pack.

File counts, sizes, the outer format and ciphertext hashes remain visible. This does not promise traffic-analysis resistance, secure process memory, publisher identity, market truth or runtime authorization. The original catalog/source pins and complete row hashes survive; encryption does not replace any source/schema/time/economic/action/election/financial gate.

The existing unencrypted format remains unchanged. Shared private decoder/row/catalog validators are reused to preserve its complete checks rather than creating a more permissive encrypted reader.

## Private commands and key ownership

Run from the repository root, using new destinations with existing private parents:

```powershell
node scripts/discovery-evidence-sealed.mjs key NEW_PRIVATE_KEY_FILE
node scripts/discovery-evidence-sealed.mjs seal SOURCE_OBJECT_DIRECTORY SOURCE_CATALOG_PIN KEY_FILE NEW_SEALED_DIRECTORY
node scripts/discovery-evidence-sealed.mjs verify SEALED_DIRECTORY SEALED_MANIFEST_PIN KEY_FILE
node scripts/discovery-evidence-sealed.mjs lookup SEALED_DIRECTORY SEALED_MANIFEST_PIN KEY_FILE TABLE ORIGINAL_PAYLOAD_HASH NEW_PRIVATE_JSON
pnpm test:discovery-archives
```

`key` creates an exact random 32-byte binary key with exclusive creation and never prints it. Use a fresh dedicated key per pack; do not reuse wallet, GMGN signing/API or application session secrets. Keys must be supplied as private file paths, kept separately from the sealed directory. They are not embedded in manifests, copied into the pack, passed as command-line secret values or added to dotenv/configuration. The implementation clears owned key buffers on completion as a best effort, without claiming complete process-memory erasure.

The actual prototype key is in ignored `.tmp/evidence-seal-keys-20261022-001/key.bin`, separate from the encrypted pack. It is local test material, not production key escrow. Losing that key prevents decrypting this copy. Existing original plaintext archives and private backups remain retained; they have not become encrypted merely because this additional copy exists. Independently retained manifest pins and a separately protected, tested key backup are required before remote recovery reliance. Key rotation currently means creating a new key and resealing into a new directory; no in-place rotation or automatic key lifecycle exists.

All paths resolve within ignored `.tmp`, outside `.wrangler`; key/file links and Wrangler junction aliases are rejected. Outputs cannot overwrite existing files or directories. The encrypted destination must be separate from the plaintext source. Owner-only modes are requested; Windows ACL enforcement, off-device custody and concurrent hostile filesystem mutation are not certified. No remote binding, upload, bucket/account creation, provider call, spend, retention deletion or live-state adoption occurs.

`seal` fully verifies the pinned source pack first, then revalidates the actual source bytes while encrypting. It checks the source catalog again, authenticates the saved encrypted catalog and reconstructs every original row from the saved encrypted objects before writing the final completion marker. Failures retain partial output without activation; use a new destination rather than resetting evidence.

`verify` authenticates the catalog, validates the original catalog/source contracts and complete object population, then decrypts and verifies every object and original row. `lookup` authenticates and parses the complete catalog but reads only the selected payload object. It returns `objects_read: 1` and `other_objects_verified: false`. Unrelated missing objects fail full verification while leaving an intact selected lookup possible. CLI lookup writes a **plaintext** row only to a separate new private JSON file, never to stdout or inside the sealed pack. Do not treat that explicit export as encrypted.

Offline bounds remain explicit: 10,000 objects/rows, original payloads at most 2,000,000 bytes, encrypted objects at most 2,100,000 bytes, aggregate objects at most 2 GiB, original catalog at most 16 MiB, encrypted catalog at most 20 MiB and outer manifest at most 4 KiB. Encryption and full verification loops have separate five-minute deadlines; initial source verification is separate. Exact ciphertext and gzip lengths/hashes, bounded decompression, raw hashes and original row hashes are all required. Unsupported versions, duplicate identities/nonces/ciphertext descriptors, malformed encodings, missing references and unsafe paths hold. These are offline format bounds; provider allowances and existing local calibration admission are unchanged.

## Frozen real-data proof

Uses the same historical 885-holder / 73-wallet snapshot as 113, not today's newest store or a multi-day capacity sample.

| Measurement | Result |
|---|---:|
| Original raw payload bytes | 925,125,445 |
| Encrypted objects / original rows | 958 / 958 |
| Encrypted object bytes | 167,213,875 |
| Encrypted catalog bytes | 784,565 |
| Outer manifest bytes | 378 |
| Total encrypted pack bytes | 167,998,818 |
| Increase over 113's unencrypted pack | 119,342 bytes |
| Independently matched original SQLite rows/payloads | 958 / 958 |

GCM's ciphertext has the gzip plaintext length; nonce/tag/descriptor overhead is retained in the catalog. No duplicate payloads occurred in this snapshot. The independent proof decrypts outside the tool implementation, compares the entire decrypted catalog to the original pinned catalog, and compares every decompressed payload byte and complete row hash directly with raw SQLite TEXT-column bytes. The full original SQLite file hash remains unchanged.

The seal operation, including source and output verification, took 28.74 seconds locally. A separate full verification took 16.29 seconds. Six first/last/largest-row lookups read the 784,565-byte encrypted catalog plus one 5,364–367,039-byte object, taking 42.11–75.46 ms locally. This is not an indexed lookup, a speedup over 113, remote latency, billed Worker CPU or Free certification. Parsing/decrypting the entire catalog remains a reason to build a bounded queryable index before runtime adoption.

| Retained artifact | SHA-256 |
|---|---|
| Original canonical object catalog | `207372536ffc586ced760196e6d45213de258f27d5f731ce4cf3720bdaef3c3f` |
| Original SQLite file | `40f45fa51b9e5287b2ee44dfb98c094b414504d25a69984b2a24ee5dc2fbf2ec` |
| New canonical sealed manifest | `ebc5cbf3fbbbdf4ef46d01bf755d059a8fbe033a80b5595c8b5adf388309c76d` |
| Independent proof file | `db84a8878a790552c582e6fb3dba59268609709accb542b057b8a92501eafad7` |

Private artifacts: `.tmp/discovery-evidence-sealed-20261022-001/`, `.tmp/evidence-seal-result-20261022-001.json` and `.tmp/evidence-seal-proof-20261022-001.json`. Manifest pins hash canonical serialized bodies; the proof pin hashes complete file bytes. No key value or fingerprint is recorded here.

## Verification and next implementation

**36 archive tests pass:** 28 existing cases plus eight encrypted-storage cases. They cover full/selective exact-row recovery including BOM/NUL/Unicode/empty payloads and deduplication, source independence, separate keys and exclusive outputs, wrong keys/pins, authenticated catalog corruption/nonces/tags, swapped valid object descriptors, repinned object corruption, original metadata hash failures, incomplete populations, malformed contracts, unsafe paths/links, altered source refusal and private CLI exports. The existing security CI command includes the new suite; no hosted run is claimed.

Original live evidence hashes and foreign keys remain intact. Syntax, security preflight, secret exclusion and the existing built thesis-only closure assertion pass. Actual API-key exclusion is checked in decoded evidence and changed source/built assets; raw/hex/base64 encryption-key exclusion is checked in the pack and task files. Key files remain ignored and untracked. No Worker/runtime/UI/dependency/migration changes require another app build for this offline slice; unrelated Network/legal work is excluded.

Next build a scratch compact metadata/index database with exact lookup proofs and measured allocation, indexed read/write costs, row overhead and growth. Keep private authorization and original cohort/election replay in the runtime-resolver design. Before any remote use or live relocation, verify existing Free entitlement, account-wide usage and no-spend controls, protected key custody/restore, off-device recovery, stopped-owner adoption and rollback. Cloudflare's [R2 data-security guarantees](https://developers.cloudflare.com/r2/reference/data-security/) are separate from this local format and do not establish those deployment prerequisites. Continue broad admitted F1 observations and preregistered F3 economic qualification without extra unapproved source traffic.

All Free/provider budgets, score-v4, evidence/action/election/financial gates and production thesis-only closure remain. Public/automatic experimental serving adoption stays held. No live evidence relocation, source collection, restart, deployment or remote operation.
