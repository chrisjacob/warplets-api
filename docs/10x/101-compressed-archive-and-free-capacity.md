# Compressed recovery archive and Free capacity checkpoint

22 October 2026 (Australia/Sydney). Implements the offline compression/recovery experiment requested by [97 — product quality and capacity review](97-prd-design-performance-security-review.md), building on [91 — complete archive/restore](91-local-evidence-archive-and-restore.md). This delivers a smaller **additional private backup**, not live evidence offloading, eviction, a D1 import or a release-ready storage architecture.

## Implemented tool

`scripts/discovery-archive-pack.mjs` uses built-in Node streams, gzip and the existing complete-archive verifier; no package, paid service, API key or remote binding is added. It reads a previously exported archive rather than the live store. Every unknown table, private identity session, receipt, failed attempt, quota/lease record, cohort and original byte remains in the compressed database.

```powershell
node scripts/discovery-archive-pack.mjs pack ARCHIVE_DIRECTORY SOURCE_MANIFEST_SHA256 NEW_PRIVATE_DIRECTORY
node scripts/discovery-archive-pack.mjs verify PACK_DIRECTORY PACK_MANIFEST_SHA256
node scripts/discovery-archive-pack.mjs unpack PACK_DIRECTORY PACK_MANIFEST_SHA256 NEW_SCRATCH_DIRECTORY
node --test scripts/discovery-archive-pack.test.mjs scripts/discovery-archive.test.mjs
```

Retain the original archive manifest pin and the new printed pack manifest pin independently. SHA-256 identifies retained bytes relative to those pins; it does not authenticate an unknown author or certify market truth. The pack embeds the original manifest, including its independently checked checksum, inventory, schema and database identity. It can recover without its original source directory being present.

`pack` first verifies the source file, SQLite integrity, foreign keys and whole inventory through milestone 91. It hashes the source again while compressing and verifies the resulting gzip stream before reporting success. `verify` checks the pinned pack manifest, compressed file hash/size and exact decompressed database hash/size. `unpack` verifies first, rechecks both streams while writing exclusively into a new scratch directory, restores the original manifest, and runs the original complete SQLite/inventory verifier again. Exact stream identity and valid SQLite inventory are distinct checks; a test with caller-repinned non-SQLite bytes passes the former and fails the latter.

Bounds and failure behavior:

- Original and compressed files are bounded to **2 GiB each**; the manifest is at most 1 MiB. These are offline tool bounds, not provider quotas or new research-admission restrictions. A larger archive requires a reviewed future format/capacity decision; collection limits are untouched.
- Compression/decompression pipelines stream rather than buffer the whole database in JavaScript. Each pipeline has a two-minute deadline; existing full SQLite verification is separate. The decompressed stream cannot exceed its declared source byte count even if all metadata hashes were recomputed. Unsupported codec/path/size/hash contracts, truncated gzip, CRC errors and byte changes hold.
- Output directories must be new, with existing parents; files use exclusive creation. Lexical and resolved-parent checks reject `.wrangler`, including junction aliases. Existing files, directories, archives and journals are never overwritten or activated. Failed new scratch directories may remain; never treat their existence as success or reset them to force a retry. Use a fresh destination and verify the pin.
- The source archive and live store are neither changed nor deleted. There is no restore adoption, second collector, provider call, schedule, new allowance, counter reset, TTL, pruning or automatic upload. Owner-only directory/file modes are requested; Windows ACLs remain an operator concern.
- **Gzip is not encryption.** These full-store files contain private sessions and research. Keep the entire pack and scratch restore ignored/private, outside public assets or downloads. Do not upload them as public evidence or adopt their saved sessions/lease state.

## Real compressed restore

The experiment used the already verified archive from `2026-10-21T14:24:50.571Z–14:25:01.519Z`, **83 tables / 39,408 rows**. It is an earlier fixed snapshot, not a measurement of today's newest live store or a sustained-growth study.

| Measurement | Result |
|---|---|
| Original SQLite bytes | 1,010,376,704 |
| Gzip bytes | 189,445,222 |
| Reduction | **81.25%** |
| Original / unpacked database SHA-256 | `40f45fa51b9e5287b2ee44dfb98c094b414504d25a69984b2a24ee5dc2fbf2ec` |
| Original archive manifest SHA-256 | `a8265797af92c538a481e7074a87c317668da0125e92536732d7b61f1e1e99aa` |
| New pack manifest SHA-256 | `b7b974d04b65542a85e6fc7261d6df8fe3ae5920b4a9be748dcf1f1ecac4f73e` |

Full restored bytes, all table inventories, schema, migrations, SQLite integrity and foreign keys verify. An additional read-only semantic check confirms **1,732 original evidence row hashes** and replays one earliest retained cohort for each of v1, v2 and v4. There are no retained v3 cohorts in this archive. The original live preservation check also passes. This is not a replay of every cohort or evidence of source truth. No runtime was activated.

Private artifacts: `.tmp/discovery-gzip-20261022-001/{pack.json,discovery.sqlite.gz}`, `.tmp/discovery-unpacked-20261022-001/{manifest.json,discovery.sqlite}`, `.tmp/discovery-gzip-pack-proof-20261022-001.json`, `.tmp/discovery-gzip-unpack-proof-20261022-001.json`. Keep the original archive and old restore too; no existing artifact was replaced. Around 7.67 GB of disk space remained after the new pack and scratch restore, a point-in-time local reading only.

Private semantic proof `.tmp/discovery-unpack-replay-proof-20261022-001.json` has SHA-256 `068bb308d33ad9d861c30a2e891dcd8187b6d796478060bdfb56efd65c97e3bb`. The capacity measurement `.tmp/discovery-storage-capacity-20261022-001.json` has SHA-256 `197e89a8b94f8f29666bfdda12abe745aefa33057fcd499ef1b530d427f12cc5`. The original manifest remains the source-of-truth anchor for the old archive; the new pack pin identifies its additional gzip representation.

## Free architecture worksheet and next implementation

Current official limits were rechecked on 22 October. These published allowances do not establish account activation, unused entitlement, a hard spending stop or remote feasibility.

| Layer | Measured / published constraint | Decision |
|---|---|---|
| Queryable database | D1 Free allows 500 MB per database; string/BLOB/whole-row maximum is 2,000,000 bytes. This old database is already 1.01 GB | A direct raw-store import is held. Compression of a backup does not shrink a queryable SQLite database or let a whole gzip fit one D1 row. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| Bulky evidence | Holder table/index allocation is 869,974,016 bytes, wallet table/index allocation 56,954,880 bytes. Holder payloads alone total 868,311,250 bytes; the largest is 1,994,988. Wallet payloads total 56,814,195; largest 1,759,708 | Both sampled table populations have no individual payload above two million bytes, but that does not certify complete row overhead or other tables. Design separate compact queryable records and immutable replay evidence; do not delete/offload these rows yet |
| Cold recovery | Exact gzip representation is 189.45 MB. R2 Standard's published monthly included allowances are 10 GB-month, 1M Class A and 10M Class B operations; Infrequent Access is excluded | A candidate for private encrypted cold storage only after actual existing Free entitlement, other account usage, access and a no-spend control are verified. No bucket, billing activation, object upload or paid fallback here. One pack gives no future retention/growth guarantee. [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Public reads | Workers Free publishes 10 ms CPU and 128 MB memory; current scoring reads still replay source inputs | Keep gzip/complete-database work offline. Do not decompress this full pack in a public request. Compact precomputed reads and measured invalidation/query/CPU budgets remain necessary. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |

Next build order:

1. Build a compact versioned current score/activity projection under existing admitted local maintenance. Bind source revision, model/policy hashes, cutoff, expiry and inventory scope. Reads must hold or explicitly report stale/missing projections rather than relabel an older score fresh; independent action gates stay separate. Preserve existing evaluators and historical links/replay.
2. Measure its true database allocation, row sizes, indexed row reads/writes, per-refresh cost and controlled read latency/CPU. Account for all viewers, polling, maintenance, failures and shared account usage. The present gzip ratio cannot substitute for those measurements.
3. Before any live evidence relocation, design individually addressable immutable objects and verified manifests/recovery, encryption/private authorization, same-chain old cohort/election replay, stopped-owner adoption and rollback. A full SQLite gzip is a recovery artifact, not an online evidence lookup format. Deduplication, incremental snapshots and retention policy are not implemented or approved here.
4. Measure additional chronological admitted-day snapshots and off-device recovery before choosing a retention horizon or declaring Free sustainability. If existing Free access cannot support it, keep release held; do not buy capacity or discard inconvenient evidence.

## Verification scope and unchanged gates

**17 tests pass:** seven new compression/restore cases and all ten existing archive cases. They cover exact/private/unknown-table preservation, frozen inputs and spent allowances, independently pinned identities, source-directory independence, existing-output refusal, corruption/truncation/CRC, repinned decompression bounds, unsafe metadata, Wrangler/junction destinations and final SQLite/inventory rejection. Node syntax checks and the existing built thesis-only assertion pass. No UI, Worker, dependency or API changed, so application builds and unrelated UI suites were not repeated.

All source Free limits, admission/pacing/backoff, local calibration authority, v4, evidence/action/election/financial gates and thesis-only production remain unchanged. F5 is still partial; remote Free capacity, compact serving, active overflow, broader recovery, encryption/off-device proof and remaining parser/security work remain open. F1/F3/F4 qualification is unchanged. Unrelated Network/legal work is excluded. No deploy.
