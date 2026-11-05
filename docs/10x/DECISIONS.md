# Decisions required before functional delivery

The owner authorized building milestones 1–3 on 30 October 2026 with commits/PRs and no deployment. The defaults below remain implemented as `local-v1` for local verification. The participation design and subsequent concrete Jito policy are approved in the linked decision records; public abuse/operating review and actual deployment readiness remain separate gates. They do not resolve the later protocol/distribution decisions.

| Local-v1 policy | Implementation evidence | Remaining production gate |
|---|---|---|
| UTC timetable: previous-day 20:00 open, 19:30 close; ownership before reveal; links at freeze, Solana scope at first vote | Round, cycle and HTTP journey tests; BUILD.md | Final timetable, late ownership and launch operations review |
| Valid Farcaster vote plus verified Solana reward wallet qualifies; Base optional; shared wallet/NFT conflicts excluded/reserved | Proof, ambiguity and wallet-conflict tests | Sybil/dispute policy; manual real-account and mobile QA |
| Retained acquisition lots, proportional disposals, active-campaign opportunity normalization, floor once to +5x units | Rational ledger and replay examples; controlled-cohort design approved | Independent historical prices and complete-history source integration |
| Integer score units; earliest valid vote then FID; top 100 share the full 1% release; largest remainders tie by rank | Pure allocation, 101-voter and overlap tests; controlled-cohort design approved | Public abuse/dispute procedures and activation review |
| Zero qualifiers reserve the release; no offered round needs an explicit reasoned reserve; no silent reassignment | Empty/unoffered reserve tests | Treasury handling/disclosure of reserves |
| Closing round serves releases in `(close, close +24h]`; actual launch starts ten releases at +24h through +240h | Boundary/delay and HTTP journey tests | Final delays/overlap operations and distributor feasibility |

On 30 October 2026 the owner approved proceeding with the current participation design for the controlled cohort and selected fully locked Jito evaluation. [The approval record](approvals/2026-10-30-design.json) binds that decision to the reviewed packet. Generic participation-design approval is complete; unspecified public abuse/dispute procedures, reserve custody, physical-wallet QA, source access and financial activation remain separate gates. The exact Jito policy was subsequently approved in [the follow-up record](approvals/2026-10-30-jito-policy.json); actual custody accounts and executed proof remain pending. See [JITO-LOCKED-PROPOSAL.md](JITO-LOCKED-PROPOSAL.md).

The remaining register is reviewed against those local rules; nothing below silently adopts an archived economic setting.

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
| Claims | Fully locked Jito timing/custody policy is approved and captured program execution passes locally. Mainnet adapters, actual multisig integration, costs and custody addresses still require validation. | Protocol feasibility; complete cycle |
| Operating readiness | Source/RPC budgets, indexing freshness, operator/key authority, observability, incident response and production release checks. | Production |

Record decisions with date, rationale, affected specification sections, supporting protocol/source evidence and acceptance tests. Confirmed product rules in SPEC.md take precedence over archived research and experimental models.
