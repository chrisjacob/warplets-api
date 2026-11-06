# Stored local progression quotes

`createCollectionQuoteService({repository, crypto})` provides wallet-scoped
`issueQuote(principal, input)` and `readQuote(principal, id)`. This is an internal
application interface. Public issuance remains unmounted until quote-required
reservation exists.

The caller supplies a request key, inventory, operation kind, participant IDs,
expected asset versions, and an optional canonical decimal local ceiling. The
repository chooses the UUID, current time, 120-second expiry, and
`collection-progression-v1` policy. A null ceiling selects the derived protocol
fee. The exact fee and ceiling cover disclosed local components only; network
cost and total cost remain unknown and `executable` remains false.

The request digest binds caller-reviewed fields and wallet identity. Generated
UUIDs, time, and dependency revisions are excluded from that digest. An accepted
receipt resolves before fresh ownership, context, or expiry checks, preserving
the original quote on retry. Changed fields with the same request key conflict.

For a new request, the repository obtains at most two current participant rows
and a bounded inventory header in one three-statement snapshot. It independently
derives the quote using the shared pure planner. An atomic receipt and immutable
quote insert require the captured source, Earn, and control revisions, current
ownership and versions, inventory header, and SQL clock within the quote window.
The production SQL clock retains millisecond precision. The quote's `asOfMs`
equals the receipt creation time; indexed source revisions equal the receipt's
captured revisions. Migration 037 enforces the mandatory child and immutable
quote/receipt identity. Issuance changes no asset, operation, or source revision.

Historical reads are scoped to the original wallet. They verify the receipt,
indexed fields, source revisions, quote binding digest, outcome digest, and
receipt output digest. A returned quote carries a separate lifetime label and
`currentStateVerified: false`; successful retrieval grants no admission or
execution authority. Future reservation must use fresh context and the existing
quote acceptance planner, then atomically fence its own effects.

Actual Node/D1 acceptance covers identical rows and receipts, concurrent duplicate
requests, state changes during hashing, clock expiry before and during the write,
missing-child rollback, and recovery from a lost committed response. Private
recovery preserves the exact original quote and receipt, including expiry, while
revoking old sessions. Synthetic fixture identities and local accounting are not
chain provenance or transaction approval.
