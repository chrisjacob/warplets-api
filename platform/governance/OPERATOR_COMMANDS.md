# Guarded local electorate publication and founder decisions

`createGovernanceOperatorService` exposes two command-only methods:
`publishBallot(operator,{input,requestKey,expectedRevisions?})` and
`recordDecision(operator,{input,requestKey,expectedRevisions?})`. There is no
public operator HTTP route. Grants `governance-publication` and
`governance-decision` independently authorize their respective commands;
disabling a grant stops fresh commands. Accepted identical receipts replay
before current grants and dependencies. These advisory records grant no stage
opening, payment, custody or financial execution authority.

Publication input contains the existing ballot ID, opens time, prior tranche
opening, electorate source ID/digest, plus the fixed cutoff equal to opens time,
three sealed list IDs (holders, next whitelist, exact union), and
`sourceKind: synthetic-local-operator-fixture`. The group lists are canonical,
sorted, unique and individually bounded to 10,000 wallets. Overlap across the
two groups counts once. All raw bytes, complete list seals and private indexes
are verified afresh for a new command. Missing or mismatched evidence holds;
it never becomes an empty electorate. Retained list/group identities make the
normalized source auditable, without implying real chain completeness.
As in the legacy fixture, an operator may prepare a future scheduled ballot;
its future cutoff/source attestation is synthetic fixture data, not proof of
ownership at a future instant.

The pure reference planner produces the exact legacy snapshot hash. A guarded
five-statement mutation inserts the immutable header, compact publication
binding and all voters via `INSERT SELECT` over the union's private page indexes.
No wallet array enters the publication receipt. Migration 039 verifies complete
page coverage, exact group union in both directions, exact persisted voter set,
header, binding and result before committing. Its assertions are split into
bounded groups over the same unique publication row to respect actual D1's
expression-depth limit; no predicate was removed.

An unbound legacy ballot is never assigned invented provenance. Founder
decisions reuse the pure 48-hour ballot/notice and ASAP/7/14/30-day rules. A
complete electorate (including a valid empty electorate) and the SQL execution
clock are checked. An exact immutable legacy decision may acquire a receipt
while retaining original times and rationale; a decision already owned by
another accepted command returns `decision_already_recorded`. Altering an
accepted command conflicts. The earliest date remains advisory: actual stage
opening still requires unsold-inventory, price, capacity, notice and approval
checks in the collection publication path.

The 10,000-wallet Node/D1 fixture uses 24 preparation/commit statements, five
mutation statements and at most 33 parameters. Its receipt input/result total
1,201 bytes. D1's largest measured batch is 7,119 bytes; the Node mutation is
5,665 bytes. Tests cover exact hashes/union, missing or tampered sources/indexes,
all missing publication children, decision-child rollback, grant/clock races,
lost acknowledgements, immutable replay, empty turnout and legacy adoption.

Populated private recovery retains all 96 tables, complete source/index rows,
one publication binding, four voters, one founder decision and 14 exact
receipts while revoking old sessions. **This is not maximum-capacity recovery:**
the current per-table restore bound is 8,192 rows, so the legal 10,000-voter
electorate still requires separately measured recovery-capacity work. The
existing 24 MiB aggregate recovery bound also remains relevant to maximum
32-by-10,000 collection lists. B11 remains partial.

```text
node --test platform/governance/operator-*.test.mjs
node --test platform/edge/test/governance-operator.test.mjs
node platform/edge/node_modules/typescript/bin/tsc --noEmit -p platform/edge
```
