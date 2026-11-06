# Adopted collection recovery

The normal private v2 restore now dispatches retained adoption certificates through original stage, mint, admission economics, current history and original-object verification. Each phase advances the existing restore checkpoint under its target watermark. Recovery remains private and mutation-disabled until the existing complete reconciliation and ready transaction succeed.

The final adoption aggregate independently reads the durable, immutable semantic proofs. It rebuilds the stage, economics, current-history and object chains and compares them with their phase checkpoints. Original mint and retained control proofs are also checked directly against the accepted anchor projections. Counts and ordinals must be complete; original object keys must be distinct and linked to their retained object records. The aggregate requires the exact economics and object completion proofs before atomically recording `legacy-adoption-complete`, advancing the adoption cursor and clearing the per-adoption context.

The existing imported-authority verifier consumes only that completion proof, bound to the certificate and target watermark. It then reconciles original anchors together with later normalized mint admissions and fulfillments. Recovery never fabricates historical normalized receipts.

Proof scans process at most 32 records per call, or eight mint/control anchor projections because those carry larger JSON bodies. Limits remain 64 operations including the reserved checkpoint transaction, 256 KiB per batch, 192 KiB returned rows, 1 MiB estimated working memory and 128 KiB durable checkpoint. Empty adopted inventories traverse the same completion checks with empty proof chains. Service recreation resumes from the persisted aggregate family, ordinal and chain.

Isolated stage and mint helpers retain their explicit incomplete hold unless their caller supplies the next phase. The normal reconciler supplies the ordered successors. Missing, changed or incomplete proofs hold recovery; omitting the final completion write must roll back its checkpoint advance. A lost acknowledgement replays the accepted transaction.

This closes orchestration for the supported retained-history profiles. It does not expand the source adoption audit's acceptance of legacy progression, claims, ambiguous histories or unresolved conflicts. Such histories still require their own independent replay adapter. All financial capabilities remain disabled.

Focused aggregate fault and pagination tests are in `v2-reconcile-legacy-aggregate.test.mjs`. Full normal-pipeline Node and D1/R2 acceptance lives in `v2-adoption-full.test.mjs` and `../edge/test/recovery-adoption-full.test.mjs`; those tests carry their own exact evidence and source hashes.
