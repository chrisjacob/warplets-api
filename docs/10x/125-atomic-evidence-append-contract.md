# 125 — Atomic holder/wallet evidence appends

22 October 2026. Continues [124's complete read contract](124-complete-immutable-evidence-reads.md) and the immediate capacity dependency in the PRD. The application still uses the original D1 database; this is the compatible SQL publication prerequisite, not an encrypted write backend or a capacity cutover.

## Delivered behavior

`discovery/src/evidence-write-store.ts` centralizes the three production holder/wallet append sites. Its methods return bound prepared statements without executing any IO. Each statement remains at its original position in its caller's existing `db.batch()`, with the original result positions and surrounding bookkeeping:

| Producer | Same atomic batch |
|---|---|
| `saveCandidate` | Candidate merge, market history, holder receipt/signals, proofs and transaction/account evidence |
| Wallet snapshot cycle | Successful run, wallet receipt, candidate analysis, attempt pacing, owned lease release, work deletion and wallet profiles |
| Legacy cached wallet replay | Wallet receipt, candidate compare-and-swap, work deletion and conditionally updated profiles |

Cohort capture remains the original separate post-publication operation. It is not retroactively claimed to be atomic with these batches. Existing cached replay compare-and-swap/result handling, source checkpoints, attempt records, recovery permissions and lease predicates remain. The helper adds no independent writer, provider call, extra SQL statement, migration, binding, dependency, normalization or hashing pass. Producers retain their existing schema/hash/size certification; this helper is not an independent certification boundary.

Exact retries remain no-ops with zero changed rows. A new hash inserts the original payload string and metadata. Unlike the previous `INSERT OR IGNORE`, a reused hash cannot silently accept a different payload, mint or holder slot. Wallet receipt time must also match. A mismatch enters a deliberately failing `DO UPDATE SET payload=NULL WHERE ...`: the existing `payload NOT NULL` constraint aborts the statement and rolls back the whole D1 batch. No prior payload is overwritten, no destructive retry occurs, and no preflight read/check race is introduced. Existing producer catch paths retain their error sanitization; database error text is not a new public response contract.

Holder observation time needs its original special case: `analyzeHolders` hashes the evidence body, which excludes its externally supplied observation time. Identical content can legitimately be observed again later. Its append remains a no-op and keeps the **first stored receipt time**, even when the candidate's existing producer logic records the later observation. We do not rewrite that timestamp, normalize JSON property order, invent a new receipt or impose wallet timestamp semantics on holder hashes. JSON bytes/order and original content hashes remain authoritative.

Spent source allowances and collection checkpoints are outside publication. If append or a later profile statement fails, successful run/candidate/profile/work mutations roll back together, while already reserved wallet/global RPC and catch-up allowances remain spent. The existing failure path records the failed run/call count, releases its owned lease and delays the next attempt. No quota refund, reset, successful timestamp or cohort is manufactured.

## Verification

The new append suite covers both original table schemas after all migrations, side-effect-free preparation, exact byte/metadata retention, retry result positions, holder first-time preservation, six collision variants, later-statement rollback and previously spent allowances. `saveCandidate` integration checks original payload bytes and rollback before cohort capture. Two actual wallet-cycle fault cases reject at the append and later profile stages; both retain charged RPC/catch-up use, unchanged candidate/evidence/profile/work/cohort state, a failed run and retry pacing. Existing legacy replay success/replay checks remain required.

The reusable `node scripts/check-evidence-write-runtime.mjs .tmp/NEW-DIRECTORY` runs **11 passing native workerd/D1 cases**. It extracts the two original `CREATE TABLE` definitions from migrations, uses exclusively synthetic rows and a new isolated database, blocks outbound traffic, loads no credentials and never touches application persistence. It verifies actual D1 duplicate change counts, holder/wallet collision rollback, later-statement rollback, original receipt preservation and pre-publication spent markers. The report is private and exclusively created; reruns require a new directory.

Final private report: `.tmp/evidence-write-native-20261022-002/writes.json`, SHA-256 **`bea5db31f7fc4607c29a53bd819343a73150bcc12c9aed3f12f0d48bcaf9379b`**; the initial 001 report remains retained. This is native transaction semantics, not runtime CPU, shared Free allowance or production storage acceptance. The isolated fixture imports only the append module; it is not an application route. The focused 35-test append/wallet suite and all **1,412 Discovery tests across 95 files** pass, plus **13 encrypted-read regressions**. Discovery/app/scoped fixture typechecks, security preflight/blocklist checks, the existing thesis-only built closure and unchanged original live row hashes/foreign keys pass separately. Security CI now includes the focused regressions, native fixture and scoped typecheck; no hosted CI result or fresh frontend build is claimed.

The isolated application Worker build includes the append contract among 272 modules with only the existing `node:crypto` external. Synthetic/offline fixture, filesystem and SQLite tooling are absent from that dependency graph. This is compile/import-boundary evidence, not deployment or Free CPU acceptance. Actual credential/key exclusion and private ignored/untracked artifacts are checked separately before commit. Existing dependency-audit exceptions from 123 are unchanged; no dependency is added or patched here.

Cloudflare's current [D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) specifies ordered results and whole-batch rollback on statement failure. Implementation also follows the current [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/); installed Workers types are `5.20260801.1`. No config compatibility date or platform feature is changed.

## Next acceptance contract

The next capacity slice must implement and test a usable encrypted append target in an isolated scratch environment before any runtime adoption. The present D1 prepared-statement interface intentionally cannot represent independently committed object storage as an atomic SQL transaction.

1. Admit the private target, original source/catalog/root pins, key custody and explicit runtime generation/owner authority. The stripped capacity schema remains unusable as a whole-application database.
2. Stage and authenticate immutable object bytes before SQL publication. An existing identity with different content must hold. An uploaded/staged object alone cannot grant a readable receipt, source freshness, score evidence or job success.
3. Publish its authenticated reference and the producer's existing candidate/run/profile/work mutations together in the metadata transaction, fenced against stale owners and wrong generations. Readers must resolve a newly published row in the same authorized generation; a frozen-catalog absence proof cannot silently become a dynamic absence claim.
4. Exercise failures before/after object staging, reference publication, SQL commit and acknowledgement. Retain original authority, spent allowances, failed attempts and recoverable unreferenced objects; do not repair by deletion, refund, evidence replacement or timestamp freshening. A committed publication with a lost acknowledgement must reconcile idempotently.
5. Rehearse stopped-owner adoption **and rollback** with the entire usable target, real read/write behavior, current manifests and old/new owner fencing. Never reactivate historical sessions/leases or substitute a bookkeeping-only stopped flag. A post-commit cohort failure must remain distinguishable from a failed publication.
6. Measure actual SQL/object/read/write/storage costs, later-day growth, independent off-device recovery and account-wide Free/no-spend headroom. These are admission requirements, not inferred from successful local tests.

Broad admitted observation, independent holder/volume qualification and held-out ranking evaluation remain product priorities alongside capacity work. Model-v4, unknown/partial evidence, source/provider/research limits, action/election/financial gates and thesis-only production closure remain unchanged. No live collection, mutation, migration, restart, runtime adoption, upload, spending, evidence deletion or deploy.
