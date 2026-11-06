# Guarded local progression reservation

`createProgressionReservationService({repository, crypto}).reserve(principal,
input)` accepts the wallet's request key and the reviewed fields from a genuinely
stored progression quote. It accepts no caller-generated operation identity,
commitment, clock, asset body, fairness approval, or transaction instructions.
This adapter remains private until separately tested HTTP composition is mounted.

Accepted identical receipts resolve before expiry, pause, ownership, or current
asset-lock checks. A different body with the same key conflicts. Existing legacy
operation keys are not adopted as quote-bound receipts.

For a new request, the repository verifies the stored quote and independently
recomputes acceptance against current revealed participant data. One eight-query
snapshot captures the inventory header, at most two assets, source/Earn/control
revisions, scope state, bounded usage/spend, configured fairness policy, and
existing operation key. It never hydrates aggregate `collect_inventories.state`.
Unknown, malformed, oversized, paused, or budget-limited control evidence holds
the command.

The atomic batch claims the receipt, writes one operation and all required asset
locks, records a configured fairness request when applicable, and inserts the
immutable quote linkage. Migration 040 asserts all children before committing the
receipt. The claim checks current revisions, ownership, versions, inventory and
stored quote identity, the exclusive quote expiry, current pause state, and any
previously recorded control event whose effective time crossed the evaluation
clock. Crossing a UTC day forces a new evaluation.

Configured draws use the unchanged pinned offline beacon round and context
encoding from `randomness/request-plan.mjs`. The SQL clock must precede the
selected round, including a delay during final receipt hashing. An unaccepted
retry may choose a fresh round; an accepted retry always retains its original
operation and request. No provider is contacted. An inventory without a configured
policy remains explicitly `manual-fixture`, as in the legacy local workflow.

`collect_operations.operation` retains the legacy `$lamports` encoding. Existing
local fulfillment can consume the pending operation and still requires configured
verified-draw evidence. Reservation changes only participant `pending`, version,
and observed time; Level, traits, expiry, completed rerolls, cooldown, Vault slots,
and historical allocations remain unchanged. Asset locks describe local database
state and cannot prevent an external chain transfer.

The immutable result is a local fixture with `executable: false`. This operation
does not create a transaction intent, fund a wallet, charge the quoted amount,
broadcast, or establish custody. The quote ceiling continues to cover disclosed
local components only; unknown network cost does not become spending authority.
