# Durable pre-cut current replay

The current-state reconciler routes an asset with normalized observations at or before the activation source revision through the bounded pre-adoption helper. It retains each helper context in `legacyAdoption.currentContext`, using the existing restore checkpoint CAS and target watermark fence. The original-mint semantic prerequisite remains mandatory.

Each call advances one accepted observation. The final helper result becomes the existing later-observation context. Its baseline is the authenticated preparation-cut raw asset/Vault state, and its observation chain starts with the verified pre-cut chain. Final coverage counts include both pre-cut and later normalized events, plus the original legacy prefix. The final current proof commits that combined chain and the actual current raw-row digest. With no later events, the same final raw-row and complete-coverage checks still run before the proof is saved.

Inventories without pre-cut normalized observations retain the previous current proof preimages and post-cut replay behavior. Progression, claims, conflicts and unsupported legacy interleaving retain their explicit holds. Main recovery dispatch and aggregate readiness remain coordinator-owned.

Focused acceptance uses genuine source preparation/activation and a separately restored target with an explicitly synthetic original-mint prerequisite. It checks nonce-clear omission rollback, lost committed acknowledgement replay, stale context CAS, omitted final-proof rollback, the combined proof preimage, and both zero/nonzero later-event cases. Actual D1/R2 acceptance exercises the same durable path; existing legacy and post-cut suites remain compatibility checks. These isolated tests do not claim full recovery readiness.
