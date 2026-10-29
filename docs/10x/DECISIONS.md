# Decisions required before functional delivery

All entries are unresolved unless an explicit owner decision and implementation evidence are recorded. The local skeleton does not supply production defaults.

| Decision | Required resolution | Blocks |
|---|---|---|
| Daily timetable and delays | Round boundaries, ownership freeze/reveal ordering, actual launch timestamp, delayed/failed launch handling and interaction with reward-release windows. 20:00 UTC is a working launch target only. | Identity/rounds; complete cycle |
| Qualification and abuse | Minimum qualifying participation, wallet-link verification, duplicate account/wallet/NFT conflicts, disputes and account-abuse rules. | Identity/rounds; settlement |
| Holding normalization | Exact time-weighted calculation and active-campaign denominator, thresholds, partial days, sales/top-ups and campaign boundaries. | Holding ledger |
| Acquisition evidence | Eligible purchase detection, USD acquisition valuation, fees/rounding, provenance and verification of same-account transfers. | Holding ledger |
| Empty rounds and allocation precision | Treatment of no qualifiers, fewer than 100 qualifiers, final equal-timestamp ties, rounding remainders and undistributed daily reserve. | Settlement |
| Liquidity range | OG-denominated price bounds, initial FDV conversion and stress tests against ten daily airdrop releases. No inherited $1bn boundary. | Protocol feasibility |
| Opening fee | Supported starting fee, exact ten-minute decay and behavior under delayed or retried launch. No assumed 100% fee. | Protocol feasibility |
| Ongoing fee | Demonstrate intended 1% buy/sell fee collection in OG with the pinned Meteora integration. | Protocol feasibility |
| Permanent lock | Supported lock configuration and authorities, fee-claim authority and irreversible-action review. | Protocol feasibility; production |
| Treasury | Fee allocation, custody, disclosure, conversion and sales policy. | Complete cycle; production |
| Claims | Supported distributor, funding proofs, fee/token-account costs, multi-transaction claim-all behavior and recovery. Jito is a candidate, not a selection. | Protocol feasibility; complete cycle |
| Operating readiness | Source/RPC budgets, indexing freshness, operator/key authority, observability, incident response and production release checks. | Production |

Record decisions with date, rationale, affected specification sections, supporting protocol/source evidence and acceptance tests. Confirmed product rules in SPEC.md take precedence over archived research and experimental models.
