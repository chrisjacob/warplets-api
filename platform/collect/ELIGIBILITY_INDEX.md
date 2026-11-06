# Private eligibility-page index

`createEligibilityIndexService` creates the named
`collection.materialize-eligibility-page.v1` command for an existing private
record ID. The operator supplies a request key and optional expected revisions;
the request accepts no wallet list. The command digest binds operator, record,
key and revisions while excluding the retry clock.

`createEligibilityIndexRepository` resolves an accepted receipt first. Fresh
work requires current `collection-import` scope, reads one bounded immutable
record, verifies its bytes and SHA-256 through `prepareCollectionRecord`, and
requires an eligibility page. The index contains the exact canonical entries
array (at most 100 wallets and 8 KiB). Its SQL claim rechecks scope, revisions
and the exact retained record. A final mandatory receipt assertion makes an
omitted index child abort the transaction. Both raw records and derived index
rows are immutable.

An existing index under another command is compared with independently
verified bytes before reporting `index_already_materialized`; differing
membership is held as `index-content-conflict`. An accepted identical command
still replays after scope revocation, without reopening retained bytes. An
explicit verified empty page stores `[]`; absent data remains pending.

This is an internal SQL projection, not active eligibility, a completeness
claim, frozen electorate publication, economic approval or an external
observation. No HTTP route exposes it. A later guarded publication must join
an explicitly selected immutable list seal and every indexed page, verify the
complete list identity/order/count, and publish the final pointer atomically.
Materializing unreferenced pages grants no wallet privileges.

Migration 038 is installed. Seven Node tests and one real workerd/D1 test
cover command capture, exact members, positive empty versus absent records,
scope races, omitted-child rollback, lost acknowledgements, tampering and
immutable retention. The 101-wallet D1 fixture produced three indexes (including
an explicit empty page), with at most 27 bound parameters and 19,090 serialized
bytes in a batch. The populated private recovery fixture restored 95 tables,
one complete collection source, two indexes containing 101 wallets and eight
exact receipts while revoking the old session. No active collection or ballot
was created. Financial capabilities remain disabled.

```text
node --test platform/collect/eligibility-index-*.test.mjs
node --test platform/edge/test/eligibility-index.test.mjs
node platform/edge/node_modules/typescript/bin/tsc --noEmit -p platform/edge
```
