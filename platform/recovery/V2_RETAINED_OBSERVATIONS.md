# Retained normalized observation replay

`createRetainedCollectionObservationVerifier` verifies one accepted 041 reveal or transfer from a caller-supplied, previously reconstructed asset/Vault baseline. It does not substitute today's mutable rows, authenticate that baseline, or grant restore readiness.

The verifier checks the immutable command identity and request/output digests, every indexed binding field, retained B04 source/receipt/bytes, and the original Collect/Vault observation. It reruns the existing `prepareCollectionObservation` reducer at the accepted command's original `created_ms` and compares the complete result and effect. A transfer during a verified pending 040 reservation must reproduce its exact permanent conflict. It can return a verified conflict; the outer restore must still hold readiness.

Ordering uses canonical safe decimal `expected_revisions.source`, compared numerically and strictly. Duplicate same-asset 041 sequence values are rejected. The caller owns complete event coverage and ordering across 040/041/042 command families. In particular, the adoption-cut sequence is the activation command's `expected_revisions.source`; it is neither the legacy header revision nor the recovery watermark. Event timestamps cannot replace receipt ordering, especially for late transfers.

The target must be private and restoring or ready with a null internal write nonce. Generation and business watermark are checked before reads and after all hashes. Current evidence heads and current operator grants are deliberately irrelevant to accepted history. A missing original artifact or contradictory retained row holds verification.

Inputs are limited to128KiB, the one evidence object to16KiB, SQL batches to256KiB and combined work to1MiB. `retainedBytes` reserves the outer checkpoint's actual retained copies. Accounting includes three baseline input copies, bounded SQL materialization, byte verification/decoding copies, output serialization and the final pin read. Positive fixtures reserve267,264B for three87KiB outer checkpoints.

Acceptance uses real B04 ingestion and 041 commands, then an explicitly synthetic private target marker to isolate this verifier. Node and actual D1/R2 compare full replayed outputs for reveal, transfer and retained reservation conflict. Whole-run capture/restore integration and original mint baseline proof belong to the coordinator's separate reconciler. All underlying event evidence remains explicitly synthetic; no chain completeness, payment, external ownership proof or release authority is inferred.
