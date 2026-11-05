# Local pilot load and cost gate

These measurements check whether admission limits, idempotency and published awards hold as demand grows. They do not establish a paid-provider capacity or price. Results were measured on Windows, Node 22.22.3, with a single process serving real HTTP over loopback and an in-memory SQLite database. Every account, token and balance was synthetic.

Run from the repository root:

```text
node platform/performance/earn-load.mjs 100 1000 10000
node platform/performance/replay-race.mjs
```

The first command sends one authenticated admission request per distinct wallet, checks every response, moderates the accepted cohort, finalizes its board, records a token budget and verifies the public export. It uses the normal API router, origin checks, session lookup, request limits and database migrations. The timing starts after seeding sessions and raw admission evidence. There are no Solana calls, signatures, provider subscriptions or real transfers.

| Attempted wallets | Admitted / full | HTTP p50 / p95 / p99 ms | Sequential requests/s | SQLite rows changed at ingress |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 100 / 0 | 2.832 / 5.862 / 7.690 | 278.6 | 200 |
| 1,000 | 100 / 900 | 2.082 / 3.492 / 5.738 | 435.5 | 1,100 |
| 10,000 | 100 / 9,900 | 1.896 / 3.322 / 5.502 | 476.0 | 10,100 |

The 100-slot pilot accepted exactly 100 posts in each case. Most larger-cohort requests returned the capacity response early; the higher requests/s therefore does not indicate better full-submission throughput. Finalization, allocation and archive verification took 31.91–63.93 ms for the 100 accepted posts. They returned 507 rows to JavaScript, changed 402 durable rows and issued 1,224 measured SQL statements. The export was 28,451 bytes. Raw measurements and query plans are in [local-results.json](local-results.json).

SQLite chose indexed lookups for session, idempotency, latest per-wallet market observation, board, owner snapshot and per-wallet awards. Capacity checking uses a covering index on the epoch and counts up to 100 admissions for each attempted submission. The largest scenario issued 100,303 statements during ingress and returned 40,200 rows to JavaScript. These are local driver measures. A D1 estimate requires D1's own billed rows-read/rows-written measurements. The in-memory database grew by 3,866,624 bytes in the 10,000-session run, including seeded fixtures, auth sessions, limits and settled rewards.

The second command opens four distinct SQLite connections and concurrently retries submission, review, finalization and allocation against one file. All 16 operations completed. Exactly one submission, review, decision, board, allocation and award persisted. Closing and reopening the file reproduced the commitment. See [replay-result.json](replay-result.json). This checks a specific concurrent-write pattern; production consensus and on-chain custody need separate evidence.

## Operating assumptions to quote

- **Moderation time.** At the PRD's illustrative three minutes per review, 100 admitted posts require five operator-hours per day. At 10,000 contributors and ten posts each, an uncapped queue would require 5,000 hours. Confirm staffed capacity and lower admission before a real pilot if five hours is unavailable.
- **RPC budget.** Each accepted post needs a pool, OG quote, farm position, reference and a depth observation at admission and at close. For 100 accepted posts in one ATT, independent reads imply 1,000 logical source records. Sharing the four market inputs at the common cutoff reduces that to 604 under the stated fixture assumptions. A prospective adapter with one provider call per logical read and at most one retry would budget 1,208 attempts. Actual provider calls may differ with batching, historical lookup, simulation and multi-token campaigns. This run made zero.
- **Measure before spending.** Bring back billed API/DB units, RPC and probe charges, storage/backup growth, retry allowance and monthly included units from the actual candidate plan. Multiply measured expected excess usage by its quoted unit rates. Compare total new recurring spend against US$5/month and the first all-in paid test against the founder's below-US$10 target and US$30 exception ceiling. The report leaves provider unit price unset until quoted.
- **Required hold conditions.** Close admissions when staff capacity is exhausted. Keep a board pending when reconciliation is incomplete. Stop the paid pilot if funded supply, capped awards and burns differ, if a repeated operation changes an award, or if the full quote exceeds the approved ceiling. Do not use local latency to infer a safe public launch rate.
