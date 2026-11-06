# Integrated imported collection acceptance

`edge/test/imported-lifecycle.test.mjs` seeds only the original synthetic reference history, immutable source records and retained original objects. It copies no normalized authority, import certificate, new admission, new fulfillment, or recovery-ready state.

The local workerd fixture runs real fingerprint, source relation, historical economics, adoption preparation and activation services. Each phase is compared with the same Node source. Test-only deterministic identities keep allocated receipts comparable; the production identity generators are unchanged. Preparation uses the existing pinned streaming hash fixture in workerd.

After activation, the still-open original stage accepts a real new mint. Its wallet limit is two: the historical reservation consumes the first allowance, the new admission consumes the second, and a third request is held. The new result is ingested through B04 and settled by the guarded 046 repository. An omitted fulfillment child rolls back; a lost committed acknowledgement resolves to the original receipt. Owner-only operation reads, concealed asset reads and inventory totals match Node, while another wallet cannot read the operation. Exact Collect/Vault/history/authority/admission/fulfillment rows match across runtimes.

All sources and new evidence are explicit local synthetic fixtures. No payment or chain completeness is inferred. The acceptance proves the manual-fixture post-import path; configured historical activation is covered separately by B11.52. This slice does not claim every configured legacy policy can admit another mint, nor verified import recovery. Financial execution remains disabled and no public import endpoint is introduced.
