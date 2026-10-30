# Trading performance, separate from rewards

Performance follow-up: migration 0021 materializes three per-trader window projections at the source's exact through-time. A board requires every source to share that exact time, pins the source-ID set, checks wallet uniqueness in SQL and reads at most 64 projections at once while retaining only the top 100. It never loads full cohort histories. Each projection is limited to 32 KiB and each board to 768 KiB. Interrupted projection creation resumes by replaying the identical source import. Existing boards remain immutable. More than 1,000 cohort members or oversized projections fail explicitly; they are not silently truncated.

`moving-average-v1` ranks verified traders by realized net USD P&L for ATTN editions only. Historical purchases are replayed before applying the 24-hour/30-day/all-time sale window. Purchase and sale fees are included once. Mixed purchased/reward/deposit inventory is disposed proportionally; only the purchased portion creates trading profit. Self-transfers between verified wallets preserve basis. External disposals remove basis without inventing proceeds. Rebuys enter the surviving weighted average. OG gains remain separate by mint; unlike OG units are never summed.

Source packets contain complete normalized finalized history, wallet identity scope, independent valuation evidence references and a common through-time. Unsupported transactions, unknown prices, duplicate chain events, inventory deficits, identity conflicts and gaps block publication. The import boundary is an operator-controlled adapter, not an independent certification of manually supplied facts. Observed imports additionally require exclusive cryptographic wallet links and matching observed edition registry. No live history/price provider allowance was increased.

Migration 0018 retains immutable source versions and boards. Corrections name the current parent and reason; old boards remain unchanged. Three windows publish together from the same cohort (maximum 1,000 sources per bounded publication). Public reads perform one published-view lookup, without fetching providers or replaying ledgers. Snapshots disclose cohort, simulated/observed mode, source root and as-of time. Stale boards remain visibly stale. Public-by-default verified trading is disclosed before linking wallets.

```text
pnpm --dir meme operator trading-import source.json none "Initial complete source"
pnpm --dir meme operator trading-import corrected.json trading:hash "Corrected acquisition valuation"
pnpm --dir meme operator trading-publish <common-through-unix-ms>
```

Today includes lazy matched-window market views; Leaders separates reward points and trading P&L. Indexed charts start at the first actual common post-launch observation, include both gains and losses, break at source gaps and provide a price table. USD ATTN value multiplies its OG quote by OG/USD. These observations are display evidence, not settlement valuation inputs. Trading quotes and execution remain disabled pending approved routes, economics and wallet QA.
