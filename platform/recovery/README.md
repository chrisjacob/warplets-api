# Local public and private recovery

These modules recover an isolated local runtime. They perform no deployment,
provider calls, wallet actions, transaction broadcasts, subscriptions or messages.
Funding, claiming and burning on chain remain **unproven**.

`createPublicRecovery` and `createPrivateRecovery` are separate factories. Their
`start`, `step` and `finish` methods accept an inventory plus its independently
retained SHA-256 digest. The convenience `restore` method loops through those
steps for a local Node process; a Worker caller invokes bounded steps separately.
There is no public HTTP endpoint accepting tables, SQL or recovery capabilities.

Public recovery imports only verified public boards, allocations, awards and
catalog references. It never requires a private backup. The database enters
public recovery mode before the first import and stays mutation-disabled after
completion. Newer bundles add allocations; replaying an older bundle cannot
remove them. Public commitments and wallet proofs retain the historical Earn
format. Byte digests identify exact canonical objects; semantic digests identify
the original manifest commitments. Neither substitutes for the other.

Private recovery requires a fresh database and exactly matching ordered migration
filename/digest metadata. Its explicit table allowlist refuses unknown application
tables. Node's `schema_versions`, SQLite internals and the pinned D1
`_cf_METADATA` table are infrastructure metadata, not application rows. Auth
challenges, sessions, proof consumptions and request limits are intentionally
omitted. Recovery-control rows are not copied over the target's isolation state.

The exporter preflights size budgets, then captures all application rows and
counts in **one transactional driver batch**. Earn revision counters alone do not
certify a whole-database snapshot. A changed size or schema causes an explicit
refusal. Each private page contains at most 100 rows and 128 KiB, except collection
source-record pages allow 192 KiB for the base64 encoding of a 128 KiB root.
The restore still enforces its 256 KiB atomic SQL batch limit. The complete
inventory is at most 256 KiB, total referenced objects at most 24 MiB, and tables
at most 8,192 rows each. Capture and final reconciliation each preflight a
conservative ceiling of 900 combined SQL/object operations. Larger sources are
held for a future incremental backup design, never silently truncated.

During private restore, every data unit acquires an internal nonce and verifies
its generation and cursor inside its write transaction. The nonce must be cleared
before commit. Running jobs become held for reconciliation, their revisions
advance, unfinished attempts are fenced, execution fences expire, and leased
notification attempts become unknown. Original job identities, receipts,
checkpoints and dependency event sequences remain intact. Sessions are revoked.
The source remains untouched. Only a fully reconciled private target becomes
ready for local application writes; financial capabilities remain disabled.

Missing/corrupt objects, mismatched pins, conflicting awards, incomplete pages,
schema changes or failed audit/foreign-key checks leave the target held and
mutation-disabled. Immutable object writes always use the existing `ArtifactStore`
create-once operation. An unknown write is not treated as success or as permission
to overwrite. A retry uses the same identity and bytes. Public artifacts are never
deleted by recovery.

Keep inventory digests outside the database and object namespace being restored.
The rehearsal writes independent pin files before losing the source database,
then restores separate public and private databases and artifact directories.
Its fixture source-commit marker is explicitly synthetic. Real integrations must
provide their recorded source commit and trusted installed migration descriptor.
The rehearsal's elapsed time is a local measurement, not an availability SLA.

```text
node --test platform/recovery/recovery.test.mjs
node --test platform/edge/test/recovery.test.mjs
node platform/recovery/cli.mjs --fixture-rehearsal
```
