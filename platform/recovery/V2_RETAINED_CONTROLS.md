# Retained legacy admission controls

The private verifier consumes an independently verified adoption certificate and mint anchor. It checks the retained original control-selection identity, object proof and bytes, then replays the existing historical control-selection validator. The result must match the anchor's exact accepted control fact and permit the original admission.

The selection's historical source generation, watermark and revision stay bound to the certificate. They are not replaced with the fresh recovery target's identity. The verifier separately checks the target generation and watermark before and after all asynchronous verification, and requires a private restoring or ready target with no active writer.

Actual retained inventory and original operation rows must match the selection. Bounded as-of queries independently compare the selected scope history, usage and spend rows. Later historical ingestion that changes the as-of selection therefore holds with `retained-control-retained-history-mismatch`; it is not silently discarded. This conservative limitation is distinct from validating the frozen preimage alone, which can remain internally valid after later historical ingestion.

The helper does not authorize a baseline, authenticate original operator ingestion, prove payment, write recovery proofs or grant readiness. The economic recovery orchestrator must bind its result to the same verified anchor and durable cursor. Invalid or missing history and oversized inputs remain held.

The accepted input is at most16KiB, the original object at most147456bytes, and the combined working set at most1MiB including explicitly supplied outer checkpoint copies. SQL aggregates enforce history byte/count bounds before row hydration. Existing64operation and256KiB batch limits remain unchanged. Tests use genuine synthetic adoption followed by a separate fresh Node or local D1/R2 target; financial execution remains disabled.
