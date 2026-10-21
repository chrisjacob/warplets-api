# Protected evidence key backup and local recovery

22 October 2026 (Australia/Sydney). Implements the local protected-key prerequisite from [119 — historical resolver replay](119-scratch-resolver-historical-replay.md). The existing evidence key now has an encrypted backup under a separate generated wrapping key. A new restored key verifies **all 958 objects** and reproduces the complete **183-cohort / nine-election** replay report byte-for-byte. Original keys/evidence remain intact. Off-device custody and operational adoption/rollback remain open.

## Tool and key roles

`scripts/discovery-evidence-key-recovery.mjs` provides private offline commands with existing Node crypto/Zod dependencies:

```powershell
node scripts/discovery-evidence-key-recovery.mjs generate NEW_WRAPPING_DIRECTORY
node scripts/discovery-evidence-key-recovery.mjs protect SEALED SEALED_PIN EVIDENCE_KEY WRAPPING NEW_BACKUP_DIRECTORY
node scripts/discovery-evidence-key-recovery.mjs verify BACKUP BACKUP_PIN SEALED WRAPPING
node scripts/discovery-evidence-key-recovery.mjs restore BACKUP BACKUP_PIN SEALED WRAPPING NEW_KEY_DIRECTORY
pnpm test:discovery-recovery
```

Run from the repository root with an existing `.tmp` parent and independently retained pins. Arguments identify private files/directories; never pass secret values. Use only dedicated evidence/wrapping keys. Wallet, GMGN signing/API and application session keys are outside this tool's scope and must never be reused.

- The **evidence key** is the existing 32-byte key authenticating the pinned sealed pack. `protect` reads it and never replaces or deletes it.
- The **wrapping key** is a separate random 32-byte binary secret. `generate` writes `key.bin` plus a strict role receipt `wrapping.json` into a new private directory. Protect it independently; losing it prevents this backup from restoring the evidence key. The role receipt contains no secret or secret fingerprint.
- The **backup** is a new directory containing `key-backup.json`: a strict versioned encrypted 32-byte key envelope, source sealed-manifest pin and its own canonical manifest pin. It contains neither plaintext key, wrapping key, payloads nor a plaintext-key fingerprint. Retain its pin independently.
- The **restored key** is a new private directory with an explicit plaintext `key.bin` and a non-secret `restore.json` completion receipt. It is sensitive like the original key and is not an application configuration change.

Original/wrapping keys, sealed pack, backup and restored key must stay in separate locations. The tool refuses role reuse/equal key bytes, overlapping key directories and new outputs nested inside recognized evidence/recovery artifacts. All paths resolve inside private ignored `.tmp`, outside `.wrangler`; links/junction escapes, invalid sizes, existing outputs and overwrite attempts hold. New outputs request owner-only modes; Windows ACLs and hostile concurrent filesystem mutation are not certified.

No command prints keys or returns them in a receipt, copies them into dotenv/configuration, uploads them, creates remote resources or changes a runtime binding. Do not commit these directories or put them in public assets/downloads. Key buffers owned by the tool are cleared in `finally` as a best effort; complete process-memory erasure is not claimed.

## Authentication before plaintext output

The backup uses AES-256-GCM with a fresh random 12-byte IV, a 16-byte tag and a fixed version/role/source-pin AAD: `discovery-evidence-key-backup-v1|evidence-key|SEALED_PIN`. The independently retained backup manifest pin binds all envelope fields. Re-pinning a changed source pin, ciphertext, IV or tag does not bypass GCM authentication. Fresh randomness is generated for each backup, with no nonce override. These use the existing [Node crypto authenticated-encryption APIs](https://nodejs.org/docs/latest-v22.x/api/crypto.html), checked against Node 22 documentation and exercised in the installed runtime.

`protect` first authenticates the actual evidence key against the complete original catalog contract. It encrypts the key, independently decrypts its saved envelope values in memory, and requires exact byte equality before writing the backup. Wrapping and evidence key bytes cannot be equal.

`verify` and `restore` require the retained backup pin and strict bounded schema, decrypt the complete 32-byte key, then authenticate and validate the existing sealed catalog **before creating a plaintext output directory**. A valid encrypted envelope containing the wrong data key still holds at catalog admission. Restoring the wrapping key itself is rejected. Wrong keys, malformed/unknown fields, context substitution and corrupt source catalogs do not create restored key files.

`verifySealedKeyBytes` shares the existing `decodeCatalog` path in `scripts/discovery-evidence-sealed.mjs`: original envelope/ciphertext sizes and hashes, AES-GCM AAD/tag, strict JSON/inner schema, original source/catalog pins, object/population bounds and nonce-reuse checks remain. Existing file-key readers use the same path. Formats, original hashes and encryption framing are unchanged; decrypted catalog buffers are cleared after decoding. This avoids inventing a weaker recovery-only catalog validator.

After writing a new restored key, `restore` reads back its exact bytes and authenticates the catalog again before writing `restore.json`. It preserves partial outputs after late IO/verification failures; a partial directory may contain a sensitive key file and must remain private. No completion receipt means no completed restore. Original recovery authority is never removed or overwritten.

Catalog authentication proves the recovered key is suitable for that pinned pack. The receipt explicitly says `payload_objects_verified: false`; object availability/integrity and historical semantics require the separate full verification/replay below. No key receipt authorizes migration, live adoption, quota resets or financial actions.

## Real local drill

The source is the same 21 October frozen archive/pack as 113–119. A fresh dedicated wrapping key protected the original evidence key; the backup restored into a new directory. The original key was retained unchanged. The real drill used only the restored path for full object verification and historical replay; the code has no original-key fallback.

| Recovery check | Result |
|---|---:|
| Original/restored evidence-key bytes | Identical; never printed |
| Authenticated catalog population | 958 rows / 958 objects |
| Full restored-key object/raw/original-row verification | **958 / 958** |
| Restored-key cohorts: v1 / v2 / v4 | 71 / 29 / 83 |
| Complete cohort / election replay | **183 / 9, all verified** |
| Selected reconstructed receipt analyses in replay | 297, unchanged |
| Replay report versus 119 | **Byte-for-byte identical** |
| Provider requests / database writes | **0 / 0** |

Unknown evidence stays unknown: the replay still preserves all 2,601 candidate occurrences with neither receipt analysis. Counts are historical preservation checks, not distinct-token coverage, organic demand, eligibility, new outcome observations or a model promotion. There are no retained v3 cohorts in this snapshot.

| Retained artifact | SHA-256 |
|---|---|
| Canonical encrypted-key backup manifest pin | `d74729b0c22c23520776700ee3442d4a54bcf9e2a3af913fbf88b4523538c706` |
| Full local key-recovery proof file | `7f800427adb7862faed2538a7d494fe70980bedb8e5d0ef1edd7c0fddd478f36` |
| Restored-key historical replay report, identical to 119 | `58295b32205d066a5e4ba30dfc8a7d11ba689532139e1d14c942bc59a10eec44` |

Private artifacts: `.tmp/evidence-key-backup-20261022-001/key-backup.json`, `.tmp/evidence-key-recovery-proof-20261022-120.json` and `.tmp/evidence-key-restored-replay-20261022-001/replay.json`. Separate secret directories are `.tmp/evidence-key-wrapping-20261022-001/` and `.tmp/evidence-key-restored-20261022-001/`; their `key.bin` files must remain ignored/private. The original key remains in its original 114 location. No plaintext-key file hashes are published.

The source sealed pin remains `ebc5cbf3fbbbdf4ef46d01bf755d059a8fbe033a80b5595c8b5adf388309c76d`; original source/index/reference/capacity pins remain as documented in 114–119. Backup pins identify encrypted bytes, not operator authorship. This is same-machine local recovery: wrapping/backup/data custody on independent devices, recovery after actual machine loss and off-device access controls are **not accepted**. Local directory separation does not establish independent custody or host-compromise protection. Metadata/session databases remain private plaintext; this key backup does not encrypt them.

## Checks and remaining adoption work

Seven new recovery tests pass alongside all 51 archive, seven capacity and seven scratch regressions (**72 tests**), plus scoped tooling types. Tests independently unwrap the envelope, recover with the synthetic original key path unavailable, verify all synthetic objects, reject wrong wrapping/data keys and re-pinned context/ciphertext, malformed contracts, catalog corruption, role reuse, unsafe/existing/partial outputs, Wrangler aliases and linked keys, and verify aggregate-only CLI output. Only synthetic fixture files are renamed for the lost-original test; no real key or evidence is moved.

Security CI now runs the new suite; no hosted result is claimed. Syntax/whitespace, security preflight, existing built thesis-only closure, original live evidence hashes/foreign keys, original artifact pins and actual credential/key exclusion are checked separately. No application build/typecheck or runtime restart is claimed for this offline-only slice.

F5 remains partial. The stripped capacity schema is not runtime-compatible, so this milestone completes protected local key recovery and **does not simulate a successful operational cutover**. Before a stopped-owner adoption/rollback rehearsal can certify anything useful, provide a compatible target/read contract, preserve current failed receipts/allowances and establish exclusive owner/fencing plus exact pre/post replay. The rehearsal must retain the old store as authority, reject active/unknown owners or stale generations, and prove rollback without deleting evidence or reactivating old sessions/leases. A bookkeeping-only “stopped” flag is insufficient.

Protected metadata/off-device recovery, production root/generation/private authorization, ordinary later chronological snapshots, newer projection costs, shared account Free/no-spend/read/write/CPU acceptance and public/automatic serving remain open. No live relocation, migration, source collection, restart, remote operation, spending or deploy occurred. Current score-v4, original model semantics, all Free/evidence/time/action/election/financial gates and thesis-only production closure remain unchanged.
