# Local pilot and stress benchmark

Measured 30 October 2026, Node 22.22.3 on this Windows workstation. Run `pnpm --dir packages/meme-qa benchmark`; the report is `.tmp/meme-qa/pilot-load.json` and Linux CI uploads it with the other QA artifacts. Fixtures use isolated in-memory SQLite, ten daily overlapping campaigns, simulated accepted acquisition evidence, immutable settlement and public Worker projections. There are no provider requests, real identities or financial transactions.

| Cohort | Campaigns / classified events | Public read p95 at offered 20 req/s | Snapshot | Final settlement |
| --- | --- | --- | --- | --- |
| 100 pilot accounts | 10 / 2,000 | 31.9 ms | 2.16 s | 2.58 s |
| 1,200 stress accounts | 10 / 24,000 | 33.3 ms | 32.74 s | 52.49 s |

Each case sends 100 reads in five batches of twenty, paced at one batch/second (measured approximately 19.84 req/s). The benchmark verifies that these reads neither mutate state nor query the ledger/version event tables. Snapshot and settlement durations exclude fixture preparation; source collection is independently budgeted. Every synthetic vote has integer milliseconds, a distinct reward destination and two classified movements per campaign. Campaigns are launched on separate days, preserving the one-launch/day invariant.

The measured cases pass the proposed local budgets: read p95 <1 second, snapshot <2 minutes, settlement <5 minutes. Public startup remains 68.8 KiB gzip against the existing 80 KiB budget. Holding aggregation now advances a sorted credit prefix rather than rescanning every lot at each earning boundary; exact fractions and existing accounting rules are unchanged.

**This is not production certification.** In-process D1 transport substitutes SQLite and excludes network, D1/service limits, scheduling/queue delays, large cohort histories, provider latency and physical wallets. It exercises accepted simulated evidence, not live source completeness. Repeat a longer sustained and burst load test, with actual history distributions and deployment-specific limits, on separately authorized infrastructure before the 100-account financial pilot. Android, source reconciliation, custody and transaction authorization remain independent gates.
