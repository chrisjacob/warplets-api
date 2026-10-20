# Private content operations and capacity observations

21 October 2026 (Australia/Sydney). Advances PRD §§7.1 and 15.1 and P8a in the [task map](19-prd-task-map.md), extending [contributor hold reviews](34-contributor-hold-reviews.md). Product documents guide implementation; the founder's local-only, free-first, unchanged-evidence-gates and no-deploy instructions control execution.

## What is available

The operator's [Content operations · private](https://app-local.10x.meme/admin/10x#content-operations) panel now shows:

- Seven queues: pending, flagged and appealed content; unreviewed reports; new and resubmitted contributor hold reviews; and requests waiting for a contributor response. Each shows count, age since the last state change, and items waiting at least 24 hours. This distinguishes work awaiting a moderator from work awaiting a contributor. Twenty-four hours is a diagnostic age marker, not an approved response-time commitment.
- Occupied campaign slots and seven global daily counters, with remaining capacity and the next UTC reset. Open campaign slots free as campaigns end, rather than resetting at midnight. Per-identity limits are displayed separately. Headroom is an observation, not a reservation or permission to bypass another gate; a new submission, report or hold review also consumes an event slot.
- Upheld report count, distinct held submissions and otherwise-visible submissions held out of the public feed. Several independent reports on one submission are counted as several holds and one held submission. No complaint is validated by these counts.
- A sample of serialized payload sizes from at most the newest 200 rows in each of seven content tables, with total row count, measured row count and explicit sample completeness. Measurements use UTF-8 bytes, not JavaScript character counts. Indexes, row metadata and database overhead are excluded. No extrapolated full database size, free-tier bill or retention deadline is invented.

The panel refreshes on demand, on focus and every minute while visible with an operator token. Token removal or replacement immediately hides previous-token data; failed reads clear the displayed aggregates. Queue links point to the existing protected content/report/contributor-review panels. This milestone adds no review decisions, deletion controls or release buttons.

`GET /api/10x/admin/attention/operations` requires the existing local Bearer/browser admission. Responses use `no-store` and `Vary: Cookie`. The endpoint returns counts, timestamps, sizes and fixed state identifiers only: no submission URLs, wallet identities, contributor messages, claims, supporting references, report IDs or credentials.

## Accounting, evidence and retention boundaries

`content-limits.ts` now supplies the unchanged numeric values used by both atomic write guards and the capacity view. The limits remain ten open campaigns; twenty new campaigns, 100 submissions/300 content events, thirty reports/150 report events and twenty hold reviews/100 hold events per UTC day. Per-identity daily bounds remain ten submissions, three reports and three hold reviews, with ten reports per submission. No evidence, resource or economic gate is relaxed.

One prepared SQLite statement observes all aggregate counters at the same read snapshot, using [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/). Trusted code-owned table/status identifiers form the query; request values cannot select tables or alter SQL. Indexed counter reads and bounded payload sampling avoid returning or decoding full histories. Exact inventory counts still depend on retained row counts: this is not a certification of remote CPU/query budgets or unlimited retention capacity.

The response explicitly declares `integrity: projection_counts_only`. It is operational telemetry, not full hash replay. Each individual case must still pass its existing history verification before a review. Read-only aggregates cannot change visibility, release a hold, grant rewards, verify authorship or alter immutable snapshots. Historical hashes, backing/election/research evidence and source quotas are unchanged.

**Automatic deletion is off; archival policy remains unconfigured; remote capacity is uncertified.** This milestone makes those gaps and retained data growth visible. It does not select a legal retention period, delete confidential reports or break immutable event chains. A controlled export/archive and retention policy, moderator staffing/abuse escalation and production budget review remain separate tasks. There are no new dependencies, providers, secrets, migrations, collectors, paid resources or outbound messages.

## Validation

- **362 discovery tests across 34 files passed**, including all 34 content tests. New cases cover operator-only admission, aggregate privacy, read-only behavior, independent versus distinct hold counts, contributor/moderator queue transitions, UTC midnight boundaries, 24-hour waiting markers, campaign expiry, UTF-8 size measurement, sample truncation and over-capacity observations. An existing concurrency test now accepts either legitimate winner while still requiring exactly one successful admission and conflict on changed UUID reuse.
- **21 focused app tests across five files passed**, including private operations gating plus existing content, identity, navigation and shell behaviors. Discovery/app typechecks passed.
- App build and performance budget passed: home shell startup remains **233.9 KiB gzip**, with the expanded operations UI inside the existing lazy content chunk (**12.21 kB gzip**).
- The isolated Workerd/D1 signed-flow exercise passed: populated hold/event counters, sample rows, privacy, independent hold release and all existing signed contributor/report/replay checks. It made zero provider calls, used disposable identities, left zero synthetic records in the main application database and stopped its owned runtime afterward.
- The read-only `scripts/check-content-operations-local.ts` passed against the running local service, keeping the existing credential in memory on loopback. Unauthenticated and foreign-Origin reads were denied. Main content counters correctly showed zero records; no test content was inserted for presentation.
- Local security checks denied fifteen private-file paths and passed ten operator Origin/body checks. The timer and independent watchdog remained healthy, and three retained election rehearsals replayed with zero provider calls. Browser review verified the protected panel without entering operator credentials or connecting a user wallet.
- OpenAPI adds one protected aggregate route and one response schema; existing contracts remain intact. No deployment or migration is needed.

Commands from the repository root:

```powershell
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app test -- src/discovery/AttentionContent.test.tsx src/discovery/navigation.test.ts src/discovery/walletIdentityClient.test.ts src/spaHistory.test.ts src/MiniAppShell.test.ts
pnpm --dir app build
pnpm exec tsx scripts/check-attention-content-local.ts
pnpm exec tsx scripts/check-content-operations-local.ts
pnpm exec tsx scripts/check-discovery-operations.ts
node scripts/check-tenx-security-local.mjs
pnpm exec tsx scripts/generate-discovery-openapi.ts
git diff --check
```

Next P8a work: source-specific authorship/provenance, controlled export/archival and retention decisions, near-duplicate evidence and validated attention inputs. Ten eligible recent tokens, broader funding coverage, live rewards/claims and the [provider credential rotation follow-up](29-security-review.md) remain open. This milestone makes no progress claim about those separate acceptance targets.
