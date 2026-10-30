# Evidence checkpoints and pilot coverage

30 October 2026. This work stays local and does not grant source allowances or authorize collection.

Large immutable versions now seal with **200-event keyset pages**, one wallet replay page per step, then **20-receipt source pages**. The cursor is `(slot, signature, event index)`, not an offset. Closing the version precedes manifest reads, preventing a concurrent append from escaping validation. Exact rational holding state survives restarts; duplicates, negative balances, contradictory timestamps, missing receipts and independent-price gaps fail closed. Fenced revisions reject concurrent page commits. A lost response resumes from the last committed checkpoint.

New manifests above 5,000 events use a version-2 folded event commitment and explicit count. Existing small manifest construction and accepted historical hashes remain unchanged. Corrections still require a reviewed matching manifest and cannot alter frozen settlement cutoffs. Scope accepts up to 10,000 unique wallets (1 MiB maximum start request); this is an explicit bound, not an implicit claim to complete Farcaster wallet discovery.

Provisional score jobs also replay accepted version histories in 200-event pages. A participant with more than 5,000 events no longer becomes pending solely for crossing that old threshold. Public reads still use materialized score projections and never advance these pages or collect evidence. Legacy manual ledger snapshots keep their existing 5,000-event participant bound: migrate future accepted inputs through evidence versions, without rewriting finalized history.

Each persisted exact replay checkpoint is bounded to 1 MiB. Extremely fragmented positions or huge rational denominators can still hit that reviewed memory allowance; the job blocks rather than discarding history. The new 6,001-event test proves manifest sealing and participant replay against the existing local-v1 arithmetic. It does not certify arbitrary history size or production throughput. The 100-account initial pilot still requires complete accepted evidence for every included account.

## Ownership audit

The direct Warplets SQLite export requires all 10,000 token IDs, valid owners and ten resolved attributes, with observations no older than 24 hours. It now records oldest/newest owner timestamps and explicitly identifies its consistency as **cache-snapshot**, `chainSnapshotVerified: false`, `financialFreezeEligible: false`. This avoids presenting mixed observation times as a common chain checkpoint. It remains usable for supervised local development.

For a financial pilot, pin Base chain 8453, collection `0x780446dd12e080ae0db762fcd4daf313f3e359de`, finalized block number/hash/time and collection observation time. Reconcile all source owners to that block, including transfers around the cutoff, and retain the actual RPC/log evidence and hashes. A recent fetch does not make an older finalized block current. That full live chain reconciliation is **pending**; the cache export is not its substitute. The historically verified #9425 purchase remains reference evidence, not a fresh round freeze.

## Provider approval packet — unapproved

| Source | Required before collection | Present allowance |
| --- | --- | --- |
| Existing Warplets ownership source | Full 10K audit, finalized cutoff and mismatch report; measured Base read allowance | Existing caps unchanged; no new full-chain scan run |
| Helius complete Solana history | Server-only credential, exact wallet/campaign scope, history start/cutoff, finalized receipt support, reserved retry cost and monthly/daily ceilings | **0 new credits** |
| Pyth historical independent prices | Credential where required, mint→feed mapping, quote/payment decimals, confidence/staleness policy, historical coverage and independently reviewed trust model | **0 new requests** |

Use the existing reservation/checkpoint ledger: failures retain consumed allowances and retries reserve again. Budget the entire cohort plus pagination/retries before approval. Unknown prices, unsupported transactions or exhausted allowance leave evidence incomplete and block settlement. Do not substitute trade price for independently verified historical acquisition price, infer a zero balance from missing history, silently omit an account or reset provider usage.

Production-readiness evidence still needs a real cohort, provider reconciliation and deployment-specific performance results. No new provider key, paid resource, tunnel or production migration was created by this stage.
