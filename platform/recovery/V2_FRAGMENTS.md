# Fragmented configured trait policies

Migration048 adds excluded, append-only restore control storage for oversized
`fair_inventories` rows. Existing small v2 pages retain their format and bytes.
All unrelated oversized rows continue to hold explicitly.

The new private descriptor format is `10x.local.recovery.fragmented-row.v2`.
It binds the installed schema fingerprint, exact ordered columns, rowid and
prior cursor, character/byte totals and ordered immutable fragment identities.
Its representation is **SQLite JSON array text encoded as UTF-8**. It is not a
canonical re-encoding of an existing v2 row page. Node and workerd parity tests
cover BMP/astral Unicode, quotes, backslashes, newline and NUL escapes.

Each fragment is at most8192 Unicode characters and32768 UTF-8 bytes. A logical
row is limited to1MiB,128 fragments and a64KiB descriptor. Fragments are private
content-addressed octet-stream objects; they are included in the exact recovery
object totals. Repeated identical fragments may share an object identity while
retaining distinct ordered positions. Lone UTF-16 surrogates, invalid UTF-8,
missing/reordered positions and inconsistent totals are rejected.

Capture reads one SQLite substring per continuation under the existing schema,
generation and whole-business watermark. It retains identities in the immutable
capture ledger, with only the current header/index in the checkpoint. Any source
write before capture seals invalidates the run; source writes are never paused.
An acknowledged or ambiguous accepted chunk write replays through that ledger.

Restore verifies each object and inserts one text fragment under the matching
active private restore nonce. Every insert has an exact mandatory-effect check.
After checking the complete metadata prefix and totals, SQLite assembles the row
using ordered `group_concat(text,'')` and extracts the exact scalar columns. The
whole row is never sent as a parameter or returned to the application. A second
mandatory check compares the installed row's exact SQLite JSON text with the
assembled original; a missing or conflicting child cannot advance the cursor.

Reconciliation uses the target watermark pinned after all imports/fences. It
hashes one target SQLite substring per continuation against the original chunk
identity, then checks the complete proof count and exact row range. The final
target-ready guard remains unchanged. Fragment controls have no business
watermark triggers, are excluded from the business snapshot, and reject writes
outside the active private restore nonce.

The demonstrated valid maximum-choice Unicode policy has3 fields,256 choices per
field and128 UTF-16 units per name:311075 policy bytes, retained in16 fragments.
Acceptance includes an already fulfilled configured mint, fresh Node/D1/R2
targets, exact raw policy retention, real pinned offline BLS in workerd,
source-change/restart, omitted fragment/assembled-row/proof rollback and lost
accepted fragment/row acknowledgements. Reference tests label their injected
verifier as synthetic. There are no provider calls or financial transactions.

```powershell
node --test platform/recovery/v2-fragments.test.mjs platform/recovery/v2-fragment-planning.test.mjs
node --test platform/recovery/v2-fragment-roundtrip.test.mjs platform/recovery/v2-fragment-faults.test.mjs
node --test platform/edge/test/recovery-fragment.test.mjs platform/edge/test/recovery-v2-restore.test.mjs
```

This closes the measured configured-policy row limit. It does not activate
normalized source imports, add a public recovery route, complete B11 or authorize
recovery of oversized legacy aggregate inventory state.
