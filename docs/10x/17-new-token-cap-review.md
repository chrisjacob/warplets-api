# New-token reported-cap review

Implemented locally on 20 October 2026 following the founder's observation that tokens created within 24 hours with a reported market cap above $10M warrant suspicion.

Discovery cards and token details now show a review warning when a retained creation proof places the token within the last 24 hours and the saved provider market cap is strictly above $10M. The discovery summary counts warnings in the current filtered view, not across all Solana launches. At the initial cached review, seven tokens in the current 100-token view met this threshold, with reported caps up to approximately $246M.

This is an unvalidated review heuristic, not an established scam rate, a fraud allegation, a new exclusion gate, or a ranking preference. Existing evidence gates, collection scheduling, frozen election inputs and research snapshots remain unchanged. A subsequent rule proposal would need outcome measurements and chronological holdout validation.

The detail warning shows the market snapshot timestamp, freshness, and reported liquidity-to-cap ratio. Stale reports remain explicitly labelled; a future market timestamp cannot appear fresh. Missing liquidity stays unknown. The ratio does not establish cash backing or executable exit liquidity. Unknown, future or older-than-24-hour creation times do not satisfy the flag; exactly $10M does not satisfy it. FDV never substitutes for missing market cap.

DEX Screener documents that FDV uses supply multiplied by price and that market cap can use self-reported circulating supply. This supports reviewing supply and pool depth alongside the reported number; it does not establish that a particular token is fraudulent. See [DEX Screener's calculation documentation](https://docs.dexscreener.com/token-listing), checked 20 October 2026.

The diagnostic runs entirely against data already returned by the local API. It adds no provider requests, paid services, migrations or deploys.

Validation: all 181 discovery tests passed, including new threshold, age, freshness, missing-data and non-mutation checks. Discovery typecheck, app build/performance checks and browser verification are recorded with the implementation commit.
