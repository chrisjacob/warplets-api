# Guarded local advisory votes

The Node application and workerd router share `handleInteractiveGovernance`,
`createGovernanceService`, the portable read model and the guarded repository.
The compatibility `handleBallots` export delegates to the same implementation.
Public ballot reads retain their existing DTOs: turnout is visible, per-choice
counts remain null before closing, and individual wallets/votes never appear.
These are labeled local fixture ballots, not verified chain governance.

A wallet POST supplies only `{choice}`. The authenticated wallet and route
ballot ID produce the deterministic `governance.cast-vote.v1` command key.
Accepted receipts replay before current time/revision checks. An immutable
legacy vote with the same choice can acquire a receipt while retaining its
original vote time. Altering an accepted body conflicts. No operator scope is
granted by a member session.

Fresh admission reads the frozen ballot, one membership, one prior vote and
the aggregate electorate count. It never hydrates all voters. It rechecks the
full electorate count, immutable header, membership and SQL execution clock
inside the receipt claim. One gated vote child and the mandatory final receipt
assertion commit atomically. Persistent revision changes hold after one retry;
incomplete/malformed retained ballot evidence is explicitly unavailable.
The production clock expression is SQLite runtime time; only private fixtures
can supply the driver clock expression used for deterministic fault tests.

Migration 036 freezes ballot/electorate/vote/decision rows and prevents adding
members beyond the published count. Existing recovery isolation also guards
these tables. Final founder decisions and electorate publication still use
the existing command-only reference helpers; their guarded portable commands
remain the next governance slice. This slice does not complete B11 collection
reservations, progression acceptance, observations or founder publication.

Focused acceptance:

```text
node --test platform/governance/*.test.mjs platform/application/collection-governance.test.mjs
node --test platform/edge/test/governance.test.mjs platform/edge/test/runtime.test.mjs
node platform/edge/node_modules/typescript/bin/tsc --noEmit -p platform/edge
node platform/contracts/generate.mjs --check
```

The 10,000-wallet local fixture admits with at most three returned rows per
query and a three-statement mutation (28 parameters, 2,864 serialized bytes).
Node and real D1 tests cover simultaneous votes, body conflicts, original
timestamp adoption, close-time transport races, lost acknowledgements, omitted
children, immutable rows, zero turnout, no early counts, genuine Ed25519 wallet
login, ordinary/enveloped generated-client responses, origin/session/body
guards and rate limits. Financial execution remains disabled.
