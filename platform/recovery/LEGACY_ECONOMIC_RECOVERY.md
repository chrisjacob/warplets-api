# Original admission economics during recovery

The private continuation starts only after the exact certificate, imported-stage prefix and original-mint proofs exist on the pinned target. It reconstructs the original economic prefix, then processes each admission through control, stage/membership and advance steps. Original controls, prepare facts, membership and advance proof digests must match their accepted retained commitments. The existing pure admission auditor independently applies prices, limits, founder spend, eligibility, quotas and settlement ordering.

The control step atomically records `legacy-adoption-control` with scope=adoptionId, ordinal=the original admission ordinal and itemCount=1. Its result digest is SHA256 of canonical JSON for `['v2-legacy-controls', adoptionId, ordinal, anchorBodyDigest, controlFact, controlSelectionIdentity]`. This exact proof allows later object closure to avoid a second large historical-control semantic replay; identity, bytes, canonical object body and same-anchor economic completion remain mandatory.

Each successful advance records `legacy-adoption-economics` and extends `economicChain` in the same compare-and-swap. Final counts and the complete economic result must equal the certificate's accepted result before a separate completion proof permits current-history reconciliation. Final adoption readiness additionally requires current graph, private objects, proof aggregation and mixed authority checks.

The historical-control verifier explicitly releases original bytes/text and parsed selection after hashing the expected history. It then compares the actual bounded as-of rows by digest. This preserves exact history equality without simultaneously retaining both large representations. The outer checkpoint reserve remains included in the unchanged one-MiB bound.

Genesis bind reconstruction preserves the original slot JSON property order from the retained asset row. Canonical anchor slot values still constrain its semantics; canonicalization must not rewrite an original byte-sensitive bind event. Optional test fixture settlement follows the actual admission ordinal, including equal timestamps.

Tests use genuine synthetic histories and fresh Node or local D1/R2 targets. Missing prerequisites, omitted control/admission/completion proofs and lost acknowledgements cannot partially advance the cursor. No payment, original operator authentication, financial execution or release authorization is inferred.
