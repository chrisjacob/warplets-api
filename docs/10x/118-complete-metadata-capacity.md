# Complete metadata allocation and chronological growth tooling

22 October 2026 (Australia/Sydney). Implements the complete-store allocation step from [117 — evidence runtime guards](117-evidence-reference-runtime-guards.md). The fixed historical snapshot can be represented by **83.09 MB of queryable metadata plus a separate 2.08 MB reference database**, preserving all remaining values. This is a private allocation experiment; F5 and production storage adoption remain partial.

## Tool and preservation contract

`scripts/discovery-metadata-capacity.mjs` uses existing Node SQLite and archive/reference validators. No new dependency, application route, migration, binding, provider collection or runtime configuration is introduced.

```powershell
node scripts/discovery-metadata-capacity.mjs study ARCHIVE ARCHIVE_PIN REFERENCES REFERENCE_PIN NEW_PRIVATE_DIRECTORY
node scripts/discovery-metadata-capacity.mjs verify STUDY CAPACITY_PIN
node scripts/discovery-metadata-capacity.mjs compare BEFORE BEFORE_PIN AFTER AFTER_PIN NEW_PRIVATE_JSON
pnpm test:discovery-capacity
```

Run from the repository root with an existing `.tmp` parent. All inputs/outputs stay inside ignored private `.tmp`, outside `.wrangler`; links, journal sidecars, existing outputs and nesting within source evidence artifacts hold. Failed/partial outputs remain retained and lack a completion report. Owner-only modes are requested; Windows ACLs and hostile concurrent filesystem mutation are not certified. The study copies private session/research data: neither its database nor its report belongs in public assets, downloads, Git or unapproved remote storage.

Study admission fully verifies the independently pinned archive and the entire pinned reference database. The reference context must name that exact archive. Every original holder/wallet row then matches its reference metadata, raw bytes/length/SHA and original complete-row hash. Both source table populations must match; unknown original evidence layouts hold. This does not read, decrypt or reverify the ciphertext objects. Their existing authenticated recovery gates remain mandatory.

The tool creates a **new separate copy** of the complete archive. Only that copy undergoes `DROP COLUMN payload` on `tenx_holder_evidence` and `tenx_wallet_evidence`, followed by vacuuming. It never updates or vacuums the original. All original tables remain, including unknown/new tables, failed receipts, spent allowances, cohorts/elections, identities and sessions. The two stripped tables keep their original metadata and indexes. The proof database remains separate; their measured byte totals are added conservatively, rather than claimed as the exact size of a merged/imported database.

The copy deliberately lacks the original payload schema and is **not a runtime/restore target**. It cannot support the original readers without a separately accepted resolver. Payload-dependent schema holds instead of silently dropping views/triggers. Every other schema entry must remain identical. SQLite integrity and foreign keys pass. Per-table multiset fingerprints compare all remaining column names, stored types and exact values against the original; TEXT/BLOB bytes preserve embedded NUL/BOM/Unicode, integers preserve full precision and REALs use IEEE doubles. Fingerprints preserve duplicate multiplicity. Hidden rowid identity and application replay are not certified by this value comparison.

The final report records every table's row count, logical bytes, largest value/row, physical table/index allocation and largest SQLite table-record payload, plus all `dbstat` allocations, pages and pins. A conservative two-million-byte screen identifies blockers anywhere in the remaining store; it is not a D1 import or exact remote row-metering certification. A five-minute scan deadline, one-million-row scan ceiling, two-GiB input-file bound and existing ten-thousand-reference limits bound this offline operation. These tool bounds do not change provider/research limits.

## Frozen-snapshot measurements

The source is the **21 October 14:24:50.571Z–14:25:01.519Z archive**, not the newest live database. It predates subsequent migrations/projections. “Complete” describes all 83 tables of that snapshot, not current production readiness or coverage of every subsequently collected token.

| Measurement | Bytes / count |
|---|---:|
| Original SQLite | 1,010,376,704 bytes |
| Remaining queryable metadata, including all original indexes | 83,091,456 bytes |
| Separate reference database | 2,076,672 bytes |
| Conservative sum of both databases | **85,168,128 bytes** |
| Original tables / rows retained in copy | **83 / 39,408** |
| Original holder/wallet references checked | **958 / 958** |
| Raw payload bytes referenced externally | 925,125,445 bytes |
| Encrypted object descriptor total, excluding catalog/envelopes/backups | 167,213,875 bytes |
| Metadata pages / free pages | 20,286 / 0 at 4,096 bytes |
| Largest remaining value / table record | 1,087,732 / 1,422,209 bytes |
| Two-million-byte screening blockers | None in this snapshot |

Largest remaining table/index allocations include account evidence (18,669,568 bytes), election runs (8,691,712), leads (7,557,120), ordinary evidence (6,479,872), market history (6,131,712) and wallet transactions (4,444,160). These remaining costs cannot be omitted from a storage plan just because holder payloads dominate the original database.

Current [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) specify 500 MB per Free database and a two-million-byte string/BLOB/row bound. The report screens against a conservative **500,000,000-byte** database ceiling, leaving 414,831,872 bytes relative to the sum of these two files. This is a snapshot calculation, not reserved entitlement or a forecast. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) also limits shared daily reads/writes; [R2 pricing](https://developers.cloudflare.com/r2/pricing/) has separate storage and operation allowances. Neither local bytes nor existing published included allowances demonstrate account activation/headroom, a no-spend control, remote compatibility, sustained growth, shared viewer/maintenance load or affordable CPU. No remote resource is created or queried.

## Growth admission

`compare` verifies both retained capacity-report pins, database hashes, schemas, integrity/foreign keys and full measured inventories. It requires the later archive's start to follow the earlier archive's completion. Same/reversed/overlapping snapshots hold. It reports row/allocation changes for retained/added/removed tables, metadata/reference bytes, encrypted-object descriptor-byte changes and source-schema changes. These are snapshot differences; removed data or negative deltas do not approve deletion/retention changes. Same-store lineage remains operator-selected, not independently proven.

Only **one real admitted archive** is available here. Actual chronological growth and retention horizon therefore stay **unknown**. Synthetic tests cover a later snapshot with new tables and rows, plus reversed/same-snapshot holds. They do not establish real-world daily growth. No extrapolation, forced rollover, quota reset or extra source traffic is used to manufacture a second sample. Future ordinary admitted snapshots must retain their own archives/pins before comparison.

## Independent verification and retained pins

In addition to the tool's fingerprints, a separate private check compares typed SQL value multisets in **both directions across all 83 tables / 39,408 rows**, using grouped counts and exact TEXT/BLOB byte casts rather than the fingerprint implementation. It confirms every retained value/multiplicity and both table populations, with foreign keys and original/final file pins intact. This is structural preservation, not old evaluator/cohort/election replay through a resolver.

| Artifact | SHA-256 |
|---|---|
| Capacity canonical manifest pin | `c019e2049c3457a0c7f68a2eb50e9022956a3232d8755111ea0f8467e0e071b8` |
| Capacity report file bytes | `2be17154507603c8b772e7251e677cf367a82a5964af5cce9f626101f32143bc` |
| Metadata database | `c5bd52a6eeb0aa6b726cd05754779bd2a7e059171c226e964f3f0ac66b03d801` |
| Independent SQL preservation proof | `f07b929dc0016e0f53e16998876522d6c9c1d9e681a3ed77035ce287244866ae` |

Private artifacts: `.tmp/discovery-metadata-capacity-20261022-001/{capacity.json,capacity.sqlite}` and `.tmp/metadata-capacity-independent-proof-20261022-118.json`. Retain these alongside all old/failed artifacts. Original archive manifest remains `a8265797af92c538a481e7074a87c317668da0125e92536732d7b61f1e1e99aa`, original database `40f45fa51b9e5287b2ee44dfb98c094b414504d25a69984b2a24ee5dc2fbf2ec`, and reference manifest `b61440eb7a4b5dee5c26ad228c2c841ac596d20cd0f79ec23bce17337f754772`. No new key is required by the real study.

Seven new capacity tests and all 51 archive regressions pass. They cover exact typed values/unknown tables, foreign keys and original triggers/views, pinned lineage, oversized remaining rows, chronological/schema changes, private paths/junctions/sidecars, retained partial outputs, tampering/repinned mismatched inventories, payload-dependent-schema holds and private CLI exports. The security workflow includes the new suite; no hosted CI result is claimed. Original live evidence hashes/foreign keys, security preflight, credential exclusion, syntax/whitespace and the existing built thesis-only closure are checked separately. No application build/typecheck is claimed for this offline-only change.

## PRD decision and next work

Proceed with a scratch resolver integration that proves old cohort/election inputs and score semantics still replay exactly from the separate payload objects. Preserve full source/envelope admission and original metadata/object/raw/row hashes; do not adopt this stripped copy as a live store. Keep raw resolution private/operator-only under 117's CPU/serialization hold. Measure additional ordinary chronological snapshots before selecting a retention horizon, and include newer migrations/projections and shared account usage in eventual capacity acceptance.

Protected-key restore/off-device recovery, independently admitted root/generation/private authorization, stopped-owner relocation and rollback, remote Free entitlement/no-spend controls, read/write/CPU budgets and public/automatic serving acceptance remain open. All Free/source/evidence/time/action/election/financial gates, current score-v4 and thesis-only production closure remain. No live evidence relocation, migration, source collection, restart or deploy.
