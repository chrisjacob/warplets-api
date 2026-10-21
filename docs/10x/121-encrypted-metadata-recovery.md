# Encrypted metadata recovery and exact scratch restoration

22 October 2026 (Australia/Sydney). Completes the local metadata-encryption prerequisite left by [120 — protected evidence-key recovery](120-protected-evidence-key-recovery.md). A new encrypted representation protects the frozen capacity/reference databases and their manifests, including private session records. Restoration with the previously recovered evidence key preserves every file byte and reproduces the complete historical replay. F5 remains partial: operational adoption, off-device custody and Free production acceptance are still open.

## Private offline commands

```powershell
node scripts/discovery-metadata-sealed.mjs pack CAPACITY CAPACITY_PIN REFERENCES REFERENCE_PIN SEALED KEY NEW_PRIVATE_PACK
node scripts/discovery-metadata-sealed.mjs restore PACK PACK_PIN SEALED KEY NEW_PRIVATE_SCRATCH
pnpm test:discovery-metadata-sealed
```

Run from the repository root with an existing ignored `.tmp` parent and independently retained source/pack pins. Pass file paths, never secret values. The existing sealed evidence pack and its dedicated evidence key remain separate required dependencies. This tool neither reads dotenv nor uses wallet, API, signing or application-session keys. It creates no new secret key, network traffic, remote resource or application binding.

The fixed four-file contract is `capacity/capacity.json`, `capacity/capacity.sqlite`, `references/references.json` and `references/references.sqlite`. The encrypted pack contains four fixed-role `.bin` files and `metadata-sealed.json`; caller-controlled paths and extra schema fields are rejected. It contains no plaintext database or session values. The manifest records file lengths/hashes, encryption descriptors and the original capacity/reference/archive/sealed pins. It is an additional recovery representation; original plaintext copies remain intact and sensitive.

Outputs must be new, separate private `.tmp` directories. Existing/partial outputs, nesting in recognized evidence/recovery artifacts, key co-location, Wrangler paths, linked files and junction escapes hold. The key-backup tool also recognizes the new metadata artifact markers. Owner-only modes are requested; Windows ACLs and hostile concurrent filesystem mutation are not certified. Partial outputs are retained, never automatically deleted or adopted.

## Authentication and bounded restoration

Each file is streamed through gzip and AES-256-GCM. A fresh random 32-byte pack salt and HKDF-SHA256 derive separate 32-byte encryption keys for each role from the existing evidence key. HKDF information and GCM AAD use `discovery-metadata-sealed-v1|SHA256(canonical-context-JSON)|role`. Context binds the original four source pins. Each role has a fresh 12-byte IV and 16-byte tag; duplicate IVs are rejected. The root evidence key is authenticated against the complete existing sealed catalog before use. Derived/root buffers owned by this tool are cleared in `finally`, without claiming complete process-memory erasure. The implementation uses the existing [Node HKDF](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptohkdfsyncdigest-ikm-salt-info-keylen) and [stream pipeline](https://nodejs.org/docs/latest-v22.x/api/stream.html#streampipelinesource-transforms-destination-options) APIs.

`pack` first admits the complete metadata/reference/catalog populations through the existing scratch resolver. It verifies raw/gzip/cipher lengths and hashes, decrypts the actual saved ciphertext to a sink and rechecks source files. Only after the resolver's final source-pin checks does it publish the completion manifest and its canonical pin. Retain that pin independently; a hash establishes byte identity, not operator authorship.

`restore` strictly checks the retained manifest pin, roles, schema, sizes, key and original catalog before creating output. It authenticates **all four complete compressed streams** into private quarantine before materializing any restored database/JSON. A bad final role therefore cannot leave an apparently usable capacity/reference tree. Decompression is then bounded by the exact declared raw size/hash. The complete restored metadata/reference/catalog population passes the unchanged scratch resolver, followed by final ciphertext/manifest/source-envelope checks, before `metadata-restored.json` is written.

Guards include an 8 KiB pack manifest, 1 MiB capacity manifest, 4 KiB reference manifest, 64 MiB reference database, 2 GiB aggregate raw ceiling, bounded gzip overhead and a 120-second timeout per pipeline. These are offline memory/disk-expansion safeguards; provider allowances and evidence gates are unchanged.

**Quarantine gzip files are plaintext and sensitive**, including after success or an authentication failure. Restored SQLite/JSON files and any incomplete outputs must stay private and ignored. The completion receipt explicitly retains `payload_objects_verified: false`, `off_device_recovery_accepted: false` and `runtime_activated: false`. Metadata admission validates the existing complete catalog contract; it does not newly authenticate every payload object. Original object verification remains documented in 120, and selected historical payload verification is repeated below. The pack does not copy those objects or replace the protected key backup/wrapping-key dependency.

## Real frozen-archive recovery drill

The source remains the 21 October frozen archive used in 113–120. New private pack `.tmp/discovery-metadata-sealed-20261022-001/` restored into `.tmp/discovery-metadata-unsealed-20261022-001/`, using only the evidence key restored by 120. All four original files remained unchanged and all restored hashes match exactly. The restore implementation has no fallback to the original metadata directories; a synthetic test also makes those directories unavailable. No real evidence or key was moved.

| Check | Result |
|---|---:|
| Raw four-file inputs, including manifests | 85,251,440 bytes |
| Four encrypted streams | 17,463,186 bytes |
| Encrypted outer manifest | 2,928 bytes |
| Complete encrypted metadata pack | **17,466,114 bytes** |
| Restored metadata tables / rows | **83 / 39,408** |
| Reference bindings | 958, unchanged |
| Exact restored source files | **4 / 4** |
| Original source-file changes | 0 |
| Complete historical cohorts / elections | **183 / 9, all verified** |
| Regenerated selected receipt analyses | 297, unchanged |
| Historical report versus 119/120 | **Byte-for-byte identical** |
| Replay provider requests / database writes | **0 / 0** |

The retained plaintext quarantine totals 17,463,186 bytes; scratch restoration adds the original raw file sizes. Compression does not reduce live-store allocation or establish a retention horizon. The historical replay preserves the 71 v1, 29 v2 and 83 v4 cohorts, original election candidate/input/result/record hashes and all 2,601 candidate occurrences with neither receipt analysis. There are no retained v3 cohorts in this old snapshot. This is preservation evidence, not current coverage, organic momentum, eligibility or model promotion.

| Retained artifact | SHA-256 |
|---|---|
| Canonical encrypted metadata manifest pin | `df07f5a19944ba771967729a37600db485fbca0a426b560b2e358d3a7251bb19` |
| Encrypted metadata manifest file | `e8d767835fffe3e1c8948fb697ac025f7f854a75afeaacb8a2cf1b0d434dce44` |
| Local metadata recovery proof file | `cb33bf13b25e323f1edd7b51e1230e5b25e394c9e19fa5dfc152991102903a00` |
| Restored metadata historical replay report | `58295b32205d066a5e4ba30dfc8a7d11ba689532139e1d14c942bc59a10eec44` |

Proof: `.tmp/metadata-recovery-proof-20261022-121.json`. Replay: `.tmp/metadata-unsealed-replay-20261022-001/replay.json`, through `scripts/discovery-evidence-scratch-replay.ts` using the restored `capacity/` and `references/` paths, their unchanged independent source pins, the original sealed pack and the 120 restored key. No key bytes/fingerprints are published. Original capacity/reference/archive/sealed pins remain as documented in 118–120 and in the source-bound pack context.

## Checks and next acceptance decisions

Seven new tests independently derive/decrypt all four roles; preserve BOM/NUL/Unicode, private sessions, failed spent allowances and selected payloads; restore with original metadata unavailable; reject wrong keys/pins, re-pinned context/salt/tag/ciphertext corruption, decompression over-expansion, malformed roles/paths/sizes/nonces/KDF, unsafe/existing outputs and linked keys; and check aggregate-only CLI output. All 51 archive, seven capacity, seven scratch and seven protected-key regressions pass (**79 tests** total), plus scoped scratch tooling types. Security CI now includes the new suite; no hosted result is claimed.

Syntax/whitespace, security preflight, existing built thesis-only closure, actual credential/key exclusion, private ignored/untracked status, original artifact pins and all 1,732 preserved live hashes/foreign keys are checked separately. Application routes, runtime, configuration, schema and migrations are unchanged; no new application build/typecheck, runtime restart or workerd execution is claimed for this offline slice.

The stripped capacity schema still lacks two original payload columns and is **never an application runtime/adoption target**. Restored files are valid only for the existing offline scratch resolver. Private historical sessions/leases are retained as data and never reactivated. Before an operational stopped-owner adoption/rollback rehearsal, build a compatible read/target contract with exclusive ownership/fencing, preserve current failures/allowances, and prove exact pre/post replay and rollback while retaining old authority. A simulated stopped flag cannot establish a real cutover.

Next: define that runtime-compatible target and fenced rehearsal contract; establish independent off-device data/key/wrapping-key custody and loss recovery; measure ordinary later chronological archives/newer projections and shared account Free/no-spend/read/write/CPU headroom. Production root/generation/private authorization and public/automatic adoption remain gated. This same-machine drill does not accept off-device security, host-compromise resistance or storage entitlement. Original evidence, score-v4 and all source/evidence/time/action/election/financial/release gates remain. No live mutation, collection, quota reset, deletion, spending, upload, remote operation or deploy occurred.
