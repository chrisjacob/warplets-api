# Local evidence archive and verified restore

22 October 2026 (Australia/Sydney). Implements the storage-recovery slice of F5 in the [daily product plan](82-next-product-functionality-plan.md). This is an operator tool, with no new public route, provider request, collection schedule, migration or deployment.

`scripts/discovery-archive.mjs` exports the **complete local Discovery SQLite database**, including all retained evidence, old scoring versions, outcomes, rotation manifests, failed attempts, quotas, leases, identity and content records. There is no allowlist that silently discards unfamiliar tables. SQLite's online backup API reads a fixed transaction snapshot, including committed WAL data. Only the copied database is normalized to a standalone rollback-journal file; the source is opened read-only and is not checkpointed, vacuumed, paused or replaced. Backup progress has a two-minute deadline; a failed/partial archive remains unusable without its completed manifest.

## Commands and trust boundary

Run from the repository root with the installed Node 22.22.3 (which includes `node:sqlite` backup and `dbstat`). Parent directories must already exist. Use private, ignored storage such as `.tmp`; archives contain confidential research **and identity sessions**, so keep them out of Git, public downloads, shared folders and browser assets. The tool reads no environment/credential files and performs no network requests. Directory/file modes request owner-only access; Windows ACLs remain the operator's responsibility.

```powershell
node scripts/discovery-archive.mjs export discovery/.wrangler/local/v3/d1/miniflare-D1DatabaseObject/daf636fcbef1c9ac586f35b886cf4aab026d59a97e006ac52cad422db0bcaf4c.sqlite .tmp/discovery-backup-UNIQUE
node scripts/discovery-archive.mjs verify .tmp/discovery-backup-UNIQUE MANIFEST_SHA256
node scripts/discovery-archive.mjs restore .tmp/discovery-backup-UNIQUE MANIFEST_SHA256 .tmp/discovery-restored-UNIQUE.sqlite
node scripts/discovery-archive.mjs growth .tmp/discovery-backup-BEFORE BEFORE_SHA256 .tmp/discovery-backup-AFTER AFTER_SHA256
```

Export prints database/manifest SHA-256, snapshot interval, total rows/tables and the five largest tables. **Retain the printed manifest checksum independently of the archive.** Verification/restore require that exact checksum: an embedded checksum by itself is not an authenticity anchor. Hashes detect changes relative to the retained original; they do not certify source truth, completeness of market coverage or the identity of an author. No signatures are added.

The manifest contains the whole database file checksum/size, schema checksum, migration ledger, per-table row counts and allocated table/index pages. Verification checks the pinned manifest hash, complete file hash/size, SQLite integrity, foreign keys and independently recomputed schema/inventory. It refuses journal sidecars and linked database/manifest files. A missing `dbstat`, marker table or unsupported format fails rather than producing partial measurements.

Export requires a **new directory**, and restore uses exclusive file creation. Neither overwrites an existing file, archive or partial attempt. Export/restore destinations inside `.wrangler` are refused, including parent-directory junction aliases. A restore is verified again after copying. An unsuccessful post-copy verification removes only its newly created scratch file; it never removes a directory or source. There is no automatic adoption, database attachment to the Worker, replay of jobs, counter reset or identity-session reactivation.

The restored store intentionally includes the original paused/running jobs, lease timestamps and sessions. **It is a verification copy, not a ready-to-run replacement.** Future live recovery needs an explicit stopped-owner procedure and review of those operational records; do not point a second collector at it. That procedure is still open.

## Storage measurements and retention policy

- Preserve all existing research, receipts, holder/wallet inventories, source failures, cohorts, outcomes and election/content artifacts. This milestone authorizes **no deletion, TTL, compaction, pruning or eviction** and changes no admission counter or evidence rule.
- Take manual private snapshots before significant store/schema changes and when preparing a release. Keep the original checksum, archive, verification result and restoration proof together in private operator records. No background archive scheduler or new quota is introduced here.
- Measure multiple snapshots of the same logical store on later admitted observation days before estimating sustained growth or choosing any retention window. `growth` verifies both complete archives and reports signed row/allocated-byte differences, added/removed tables and schema change. Its dates must be nonoverlapping and chronological. Store lineage is operator-selected, **not independently established**; unrelated snapshots are not a valid growth study.
- `dbstat` bytes mean allocated B-tree pages including overflow pages, with indexes separate. File bytes also include free/system pages. They are not payload lengths, compressed archive sizes, current source WAL bytes or remote D1 billing estimates. Two snapshots do not establish a forecast; the tool deliberately reports that limitation. It does not change provider Free limits or local calibration mode.
- Monitor disk headroom before another full snapshot/restore: each retains another full database copy, and a long read can delay WAL reclamation while writers continue. Successful scratch recovery is a prerequisite for any future eviction proposal, **not permission to evict now**. Capacity thresholds, sustained day-to-day growth, an approved retention/eviction policy and off-device encrypted recovery remain open. A same-disk archive cannot protect against loss of this disk.

## Real local recovery check

Snapshot interval **2026-10-21T14:24:50.571Z–14:25:01.519Z** (22 October Sydney), while the ordinary local runtime remained in place:

| Measurement | Result |
|---|---|
| Standalone database | 1,010,376,704 bytes |
| Tables / total rows | 83 / 39,408, including internal/runtime tables |
| Holder evidence | 885 rows; 869,900,288 table bytes + 73,728 index bytes |
| Wallet evidence | 73 rows; 56,930,304 table bytes + 24,576 index bytes |
| Account evidence | 4,465 rows; 18,333,696 table bytes + 372,736 index bytes |
| Archive manifest SHA-256 | `a8265797af92c538a481e7074a87c317668da0125e92536732d7b61f1e1e99aa` |
| Database / restored database SHA-256 | `40f45fa51b9e5287b2ee44dfb98c094b414504d25a69984b2a24ee5dc2fbf2ec` |

Private artifacts are `.tmp/discovery-archive-20261022-001/{manifest.json,discovery.sqlite}` and `.tmp/discovery-restored-20261022-001.sqlite`; they remain ignored/unpublished. Full archive/restore verification passed, with identical bytes, all 83 table inventories, schema, migration ledger, SQLite integrity and foreign keys. Original historical evidence hashes were also checked in the live store. The copy contains 71 v1, 29 v2 and 83 v4 cohorts; there are no retained v3 cohorts to replay.

The restored-store proof checks **1,732 original evidence row hashes** against the independently retained development baseline and successfully replays one earliest cohort from each retained version (v1, v2, v4). It makes zero provider requests and database writes. The private proof `.tmp/discovery-restore-proof-20261022-001.json` has SHA-256 `b61644d4403b799496d500f0049a14ee670e2af17b7e4d2726a39df7554904f0`. Whole-file/inventory verification covers the full copy; this additional semantic replay is a three-record sample, not a replay of every artifact or market-truth certification. About 9.17 GB of disk space remained after retaining the archive and scratch restore; this is a point-in-time measurement, not a capacity promise.

## Validation and remaining work

Ten archive tests plus thirteen adjacent migration/lifecycle/watchdog tests pass. They cover WAL-only committed data, a concurrent writer during backup, exact blob restoration, later source changes, corrupt manifests/database bytes, independently remeasured inventories, foreign-key failures, unrelated stores, existing outputs, journal sidecars, Wrangler/junction destinations and chronological growth with added/removed tables. File-link refusal is exercised on platforms allowing file symlinks; Windows tests exercise real directory junctions. The existing thesis-only built-artifact assertion passes. No UI, Worker, OpenAPI or scoring implementation changed, so application builds and unrelated UI suites are not repeated.

F5 remains partial: ordinary runtime failure reproduction/recovery, wider outage/rollover rehearsals, multi-day storage growth, off-device recovery, operational adoption and approved retention are still open. F1 broad admitted observation and F3/F4 qualification/study work remain next product dependencies. Frozen v4, every evidence/action/election gate, all provider Free limits and production thesis-only closure remain unchanged. No deploy.
