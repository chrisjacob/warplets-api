# Continued private recovery

`createRecoveryV2Restore` is a private local operator service. It consumes an
independently retained v2 root and its exact digest. It neither advertises an HTTP
capability nor changes the existing v1 format or service.

Call `start({root,pinnedDigest})`, then call `step` with the returned revision.
Persist the same pin and retry the same revision after an unknown response.
Accepted progress returns `replayed`; missing source objects can be restored and
retried without changing the pin. A held target remains mutation-disabled.
`finish` cannot bypass incomplete reconciliation. A ready result can replay
without source artifacts, but does not constitute a new verification of them.

The target must be fresh. Its installed migration inventory, table definitions
and exact watermark-trigger SQL must match the pinned schema. Every import batch
uses an internal write nonce that is cleared before commit. User sessions are
removed; running jobs and execution leases are fenced. No financial execution is
enabled by recovery.

The durable checkpoint is limited to128KiB. Root, schema and table descriptors
are written once; ordinary continuation updates use small JSON patches. Row
imports use at most40 rows and bounded SQL batches. Index traversal and artifact
verification process one bounded unit at a time. Public archives retain their
existing2MiB verification allowance; ordinary steps retain the1MiB serialized
working and64-operation limits. The test metrics account for SQL results,
artifact bytes and the largest serialized SQL batch.

After importing and fencing all rows, the service pins the target business
watermark. Each retained check and the final ready transaction compare that
watermark and the exact installed schema. Exact source pages are compared with
the expected fenced target rows, including counts and cursor ranges. Independent
checks verify the audit chain, per-allocation award conservation, retained public
commitments, graph object totals, foreign keys and revoked sessions.

Normalized collection checks additionally verify admission/fulfillment ordinal
prefixes, authority counts and original minted-slot quotas, accepted receipt
bindings, raw B04 evidence, deterministic mint outcomes and retained bind/history
records. Reveals, transfers and later progression may legitimately change current
asset metadata. Original mint effects are not treated as the current asset body.
Accepted historical effects do not require a current operator grant or current
evidence head. Configured draws require an injected trusted offline BLS verifier;
reference tests explicitly use a synthetic verifier and actual workerd restores
an accepted configured mint with the real pinned BLS adapter. Original weighted trait
fields are selected in separate continuations, retaining only selected names.

Acceptance includes fresh Node targets and actual workerd/D1 with physically
separate source/target R2 buckets, missing-object retry, omitted proof/final-child
rollback, unknown final acknowledgements, target mutation after reconciliation,
old lease rejection and deliberately invalid source audit/award data. Capacity
tests cover10000 voters with10000 votes and the separate32-list source graph
(3245 records,3200 private indexes,1000 declared admissions). The latter proves
source closure retention, not economic activation of an inventory.

## Remaining capacity boundary

A legal3-field policy with256 choices per field and128-character Unicode names
occupies311075 bytes. Per-field restore revalidation succeeds, but its source
`fair_inventories` row exceeds the existing v2 capture page bound. Capture now
reports `capture-row-bound-or-invalid` accurately. Full recovery of that policy
is **not yet implemented**; bounded fragmented capture/restore of that one table
is the next substep. Other oversized rows, including legacy aggregate inventory
state, continue to hold explicitly. B11 remains partial.

Reproducible checks:

```powershell
node --test platform/recovery/v2-restore-db.test.mjs platform/recovery/v2-reconcile-economics.test.mjs
node --test platform/recovery/v2-reconcile-collections.test.mjs
node --test platform/recovery/v2-restore-faults.test.mjs
node --test platform/recovery/v2-restore-capacity.test.mjs
node --test platform/edge/test/recovery-v2-restore.test.mjs
node --test platform/recovery/v2-capture-source.test.mjs
node platform/edge/node_modules/typescript/bin/tsc --noEmit -p platform/edge
```
