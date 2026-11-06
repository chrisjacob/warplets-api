# Guarded local progression fulfillment

`createCollectionFulfillmentService({repository, crypto}).fulfill(principal,
input)` uses the frozen `collection.fulfill-operation.v1` command name. Its
initial implementation accepts only existing guarded 040 Season upgrade and
visual reservations. Input is exactly a request key, operation ID, B04 receipt
digest and raw-byte digest. The operator needs `collection-evidence`; no public
fulfillment route is mounted. Mint fulfillment remains a separate prerequisite.

Accepted replay resolves before current grants, artifacts, clocks or operation
state. New work captures fifteen named SQL reads in one snapshot, with at most
two participants and no aggregate collection state. SQL bounds each JSON column;
total hydrated input is at most 1 MiB, including a bounded weighted trait policy.
The write batch retains the existing 100-parameter, 256-KiB driver ceilings.

The `synthetic-collection-progression-v1` B04 source binds a
`collection-operation` subject and exact `{inventoryId, operationId}` policy.
Its retained payload is at most 16 KiB and explicitly labels a synthetic local
transcript. Structural B04 verification does not establish chain ownership,
custody, payment, or complete history. The repository independently verifies the
current head, receipt, raw object, source configuration and decoded identity.

There are two explicit evidence paths:

- A manual fixture carries a proof ID, effective time and upgrade ticket or
  visual traits. It is allowed only when the original reservation and current
  inventory have no configured fairness policy or draw request.
- A configured draw carries the retained pinned Quicknet round/signature and
  derived entropy. A trusted injected BLS adapter verifies the original round,
  pinned public key and signature domain. Shared protocol helpers reproduce the
  legacy seed, rejection sampling, proof ID, ticket and weighted traits. The
  caller supplies no chosen outcome. Missing or invalid proof cannot fall back
  to manual evidence. An existing retained fair result is independently checked
  and retained byte-for-byte, including its original recorded time. Its entropy
  round time is separate from the local fulfillment time.

Only the optional beacon adapter imports the installed pinned noble dependency.
The main reference suite uses explicit trusted-port tests and never imports
that optional package. Separate beacon and real Node/workerd acceptance verify
the retained signature cryptographically and reject altered signatures even
when their entropy hash has been recomputed.

The planner re-derives the original reservation with the shared domain planner,
then applies the shared fulfillment transition. It checks both current owners,
versions and pending IDs, original fee, reveal and observation clocks, stable
Vault coordinates, current fairness terms and any permanent 041 conflict. A
held transfer remains blocked even if ownership returns. Late upgrades that
would alter already sealed launch input remain pending.

One atomic command updates the participants, writes two Level-history rows for
an upgrade, records any configured fair result, inserts the immutable fulfillment
binding and settles the original operation. Visual fulfillment writes no Level
history, and its cooldown starts at the effective fulfillment time.
Stable Vault slots, prior allocations and claims remain unchanged. Manual
attested completion retains exact legacy asset JSON, receipt JSON and
evidence-digest bytes; visual digests retain the historical
Model/Backdrop/Symbol ordering.

For configured draws, the local effective time is the trusted server time of the
fulfillment command. The retained raw event and `fair_results.fixture.at` keep
the original beacon round time. This deliberately corrects the old adapter's
backdating of delayed completion: a visual result processed a day later starts
its cooldown at that later completion, rather than arriving with its cooldown
already elapsed. Deterministic entropy, outcome, proof ID and original draw
request do not change. The SQL claim must execute within 30 seconds of the
captured server clock; an expired preparation writes no effects, a fresh retry
captures its own completion time, and accepted replay retains the first result.

Migration 042 requires the staging fulfillment linkage before any guarded 040
operation can settle, and verifies every mandatory child before accepting the
receipt. Legacy unguarded operations remain in their reference path. Positive
tests of guarded reservations now use actual B04 ingestion and the guarded
fulfillment adapter. Missing children, races and lost responses are tested
without weakening fee, cooldown, history or ownership assertions.

Private recovery includes the 100-table schema and preserves raw evidence,
original receipts, fulfillment bindings and immutable Level history. Results
remain `source: local-fixture` and `executable: false`; this path creates no
financial intents and performs no network fetch, funding or broadcast.
