# Local pilot load and cost gate

## B20 full-profile attempted load

Run `node platform/performance/earn-load.mjs --full` for the original one-campaign case, ten-campaign case and reduced-staffing case. Acceptance runs with `node --test platform/performance/earn-load.test.mjs`; setting `B20_LOAD_EVIDENCE=work/b20-load-results.json` saves measured JSON. The November 7, 2026 Node 24.22.1 Windows run passed one integrated test covering all 3,000 HTTP attempts in 15,412.9003 ms.

| Campaigns | Total distinct contributors / attempts | Staffed minutes | Accepted / refused | Local HTTP p95 ms | Aggregate export bytes | Sampled process RSS peak bytes |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1,000 | 300 | 100 / 900 | 18.935 | 28,451 | 158,892,032 |
| 10 | 1,000 | 300 | 100 / 900 | 17.605 | 80,747 | 204,738,560 |
| 10 | 1,000 | 60 | 20 / 980 | 4.421 | 19,547 | 185,180,160 |

The ten-campaign cases distribute 100 attempts per campaign, not 1,000 each. The global board cap remains 100; the staffed cap uses three minutes per review. Ten campaigns therefore admit ten posts each, or two each at 60 staffed minutes. Each scenario exports one global board and one allocation per campaign. Missing source completeness holds the board before successful finalization. All responses are checked: expected capacity refusals are counted, unexpected errors fail the run.

The original harness required explicit staffing seeding to remain compatible with the current fail-closed admission policy. This is a synthetic policy configuration, not a relaxed limit. Ten distinct Sydney launch dates span eight days and two hours: the first two cross Sydney midnight within one UTC date, then subsequent launches occur daily. Original activation timestamps are retained; allocation days remain within the existing 1–10 policy. This deliberately synthetic timing does not select launch hours or resolve the separate day-eleven release-ratification gate.

Measured admission maxima were 30 SQL statements and ten returned rows per request in all three scenarios; tested query plans use indexed searches. Tests bound admission to 50 statements/30 returned rows, each allocation artifact below 64 KiB and the aggregate below 1 MiB. SQL counters observe the SQLite/JavaScript boundary, not D1 billing. Memory is sampled after each request and phase, includes the process and prior scenario allocations, and may miss transient allocation peaks. Fixture setup, review setup and settlement timings remain separately reported. Hypothetical source sharing now accounts for four shared closing sources per active campaign: 640 logical reads for 100 accepted posts across ten campaigns, versus 604 for one campaign. Actual provider calls remain zero.

This harness measures the applicable Node SQLite loopback adapter. Actual workerd/D1 parity and recovery are separate hosted-core evidence; no 1,000-attempt D1 load or geographic p95 is claimed. Machine refusal throughput is not staffed moderation throughput, physical-wallet compatibility or production financial approval. Exact machine results are in `work/b20-load-results.json` and test output in `work/b20-load-test.log` for integration capture.

## Historical pilot measurements

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

After the founder-configurable workload queue was added, the same three workloads retained the same admission and refusal counts. Capacity now reads a per-epoch counter using its integer primary key. The trigger costs one extra row change per accepted post; the slot count no longer scans the accepted cohort for each refused request. The 10,000-wallet run changed 10,200 rows at ingress and measured 3.109 ms p95. Local timings vary with host load. See [staffed-results.json](staffed-results.json).

## Operating assumptions to quote

- **Moderation time.** At the PRD's illustrative three minutes per review, 100 admitted posts require five operator-hours per day. At 10,000 contributors and ten posts each, an uncapped queue would require 5,000 hours. Confirm staffed capacity and lower admission before a real pilot if five hours is unavailable.
- **RPC budget.** Each accepted post needs a pool, OG quote, farm position, reference and a depth observation at admission and at close. For 100 accepted posts in one ATT, independent reads imply 1,000 logical source records. Sharing the four market inputs at the common cutoff reduces that to 604 under the stated fixture assumptions. A prospective adapter with one provider call per logical read and at most one retry would budget 1,208 attempts. Actual provider calls may differ with batching, historical lookup, simulation and multi-token campaigns. This run made zero.
- **Measure before spending.** Bring back billed API/DB units, RPC and probe charges, storage/backup growth, retry allowance and monthly included units from the actual candidate plan. Multiply measured expected excess usage by its quoted unit rates. Compare total new recurring spend against US$5/month and the first all-in paid test against the founder's below-US$10 target and US$30 exception ceiling. The report leaves provider unit price unset until quoted.
- **Required hold conditions.** Close admissions when staff capacity is exhausted. Keep a board pending when reconciliation is incomplete. Stop the paid pilot if funded supply, capped awards and burns differ, if a repeated operation changes an award, or if the full quote exceeds the approved ceiling. Do not use local latency to infer a safe public launch rate.
