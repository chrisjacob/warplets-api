# Production ownership source audit

Read-only audit on **30 October 2026, 15:01–15:02 AEDT**. Queries used the existing Warplets D1 source through its existing authorized connection. No ownership refresh, collection, source mutation, provider call, allowance increase or production configuration change occurred.

| Coverage | Observed |
| --- | --- |
| Metadata rows | 10,000 |
| Cached owner rows / distinct tokens | 10,000 / 10,000; IDs 1–10,000 |
| Invalid or unresolved cached owner addresses | 0 |
| Missing metadata / null or empty attribute rows | 0 / 0 |
| Owner records never checked | **9,667** |
| Checked more than 24 hours ago | **332** |
| Checked within 24 hours | **1** |
| Malformed nonempty observation timestamps | 0 |
| Oldest / newest recorded checks | 25 August 02:22:04 UTC / 30 October 03:33:52 UTC |
| Cached current holdings for supplied warpmoji Base wallet | **1** |

Full row coverage is not full current ownership coverage. Existing cached addresses are not proof that the 9,667 unchecked owners are current. The local bridge's freshness validation correctly refuses such a full observed freeze. Nonempty attribute coverage also does not replace validation of every canonical attribute value; the sampled Cast histogram contains the expected 1X–10X values. The cache is not a unified finalized chain checkpoint.

**Financial freeze remains blocked.** Build and budget a complete reconciliation to one finalized Base block (number, hash, block time and observed-at time), retaining transfer evidence and unresolved/mismatch reports. Keep real account/FID wallet discovery scope explicit. Do not select only the convenient fresh rows, relabel an old block as current, use Network's derived holder index as authority or raise an existing provider cap to make the audit pass.

This audit confirms the cached holder case for warpmoji, consistent with the previously verified on-chain purchase of #9425. It does not create a new chain attestation or recertify a real signing journey. The underlying aggregate report remains in the ignored local evidence directory `.tmp/qa-next-stage/ownership-audit.json`; it contains public counts/times, no credentials. Full live history and independent acquisition-price reconciliation remain separate zero-budget gates in [EVIDENCE-CHECKPOINTS.md](EVIDENCE-CHECKPOINTS.md).
