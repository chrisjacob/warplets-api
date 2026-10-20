# Attention campaign accounting lab

This checkpoint implements the offline accounting portion of PRD §§7, 9.3 and 17.4. `/rewards` shows separate ten-day campaign reserves and compares both proposed boost options. `/admin/10x#attention-lab` provides a protected JSON scenario editor, saved replay and private evidence download. These are hypothetical scenarios, not launched campaigns, issued ATTN, verified content, entitlements or claims. Discovery and backing evidence gates remain unchanged.

## Budget and time rules

Each scenario contains one to ten distinct `SIM-...` assets and an explicit frozen `as_of` time no later than the server's save time. A campaign ends exactly ten 24-hour periods after its start, with an exclusive end. Only one assumed spotlight may be selected, and it must be active at the snapshot. Other campaigns continue independently; touching windows do not count as overlap. Future and past campaigns remain visible with their state at the snapshot. State does not silently change when a retained scenario is viewed later.

The campaign reserve is exactly **10% of total supply across all ten days**. Raw supply uses an unsigned u64 decimal string and must be positive and divisible by ten, so the lab never invents a reserve-rounding policy. Ten daily weights in basis points must sum to 10,000. Each day's tranche is `floor(reserve × weight / 10,000)`. Schedule rounding dust remains reserved and unallocated. Asset decimals affect display only. No total reward amount combines different assets.

Daily score rows use anonymous scenario aliases, explicit raw points, boost values, observation times and an included/quarantined/rejected disposition. The lab does not establish the completeness or truth of this supplied participant set. Duplicate campaign/asset/participant-period keys and score rows for unfinished periods are rejected. Included observations must be within their daily window and strictly before cutoff. There is no assumed grace period in this experiment. Missing or late raw evidence holds both projections and all raw ranks for the whole period. Missing boost evidence preserves raw ranks but holds both projections. Empty/all-zero eligible points hold the tranche. Quarantined/rejected rows receive no rank or projected reward.

Raw rank is computed first, with competition ranks for ties and code-point ordering for deterministic presentation. Boosts cannot change it. Inputs explicitly choose a hypothetical combined cap and bonus-pool fraction:

- **Option A:** normalize raw points multiplied by capped boost into the fixed daily tranche. Cap each final amount against its full raw-merit baseline.
- **Option B:** divide the tranche into a protected raw-merit base and a bonus pool. Allocate the base by raw points and the bonus by `raw points × (capped multiplier − 1)`. The same combined cap limits the final base-plus-bonus amount. No bonus-weight means no bonus allocation.

The cap's denominator is the participant's floored share of the **full** daily raw-merit tranche. This is an explicit lab assumption, not approval of D12. All multiplication, division and allocation use `BigInt`; no floating point reward calculation is used. Rounding dust, unused bonus and amounts withheld by a cap are left unallocated without redistribution. Per-model projections cannot exceed a day's tranche or its campaign's reserve. Option A and B are alternatives, never cumulative payouts.

The example uses ten overlapping editions, a uniform daily schedule, 1.5× combined cap, 80/20 base/bonus, and three hypothetical contributors on the first day of each campaign. These are editable examples. D11/D12 remain open, including scoring weights, schedules, cutoffs/grace, fraud appeals, boost eligibility and economic model choice. The lab does not implement chain-$10X trader emissions, OG reserves, launch liquidity or Warplet ownership snapshots.

## Persistence and access

Migration `0023_attention_lab.sql` adds a separate scenario table and creation index. It changes no wallet, election, backing or financial ledger records. A normalized strict input, result and metadata are SHA-256 hashed and retained. UUID retries return the original record, while conflicting reuse returns 409. Creation and its single audit entry commit in a D1 batch. An atomic admission statement admits at most twenty new records per UTC day, including concurrent attempts; retries remain available at the cap. This follows [D1 batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

Public `GET /api/10x/rewards/lab` returns the latest five hash-checked aggregate records with no participant aliases, input observations, review reason or operator credentials. Protected `POST /api/10x/admin/rewards/lab` creates a scenario; protected `GET /api/10x/admin/rewards/lab/:id` recomputes the deterministic result and checks hashes. The existing loopback/local-only requirement, Bearer authorization, allowed-origin checks and 32 KB request-body guard apply. Scenario creation additionally enforces a normalized 30 KB input limit, eighty participant-day rows, ten campaigns and a 500 KB combined retained input/result limit. Full private downloads contain no operator token. The editor retains that token only through the existing in-memory admin state.

No new environment variables, dependencies, provider calls or timers are added. Public summaries refresh every fifteen seconds while visible using stored data. Local scenarios have no retention purge yet; remote D1 storage/CPU and public traffic allowances are not certified. Nothing was deployed.

## Validation

The discovery regression suite passes **298 tests across 30 files**, including thirteen reward tests. Coverage includes overlapping and touching windows, raw-rank ties, cap/rounding/base guarantees, u64 precision, ten-day reserve isolation, forty varied economic scenarios, empty/missing/late evidence, excluded inputs, future cutoffs, duplicate keys, tampering, concurrent daily admission, idempotency, access controls and zero network calls in the core persistence/replay path. Discovery typecheck and app build/typecheck/performance budget pass. The focused reward tests pass again after deterministic code-point sorting and reordered-input replay checks.

Migration 0023 was applied only to the existing local database using the [Wrangler local migration command](https://developers.cloudflare.com/workers/wrangler/commands/). The local smoke check retained scenario `0243d7e4-f2e5-4c3b-8c76-cb921c0ebd11`: ten hypothetical campaigns, maximum ten overlapping, eight active at its frozen snapshot. Both retries and protected replay returned identical records; unauthenticated replay returned 401. Core recomputation matched the stored result hash, and public summaries excluded participant inputs. The checker uses zero provider requests and retains its request/evidence in ignored `.tmp/attention-local.json`; rerunning reuses that UUID.

The `/rewards` page and daily allocation disclosures were inspected through the existing local HTTPS tunnel. The admin example loader populated the editor without entering credentials, while save/replay controls remained disabled without the existing local operator token. No user wallet signature, social account, on-chain action or real identity was used.

The final operations check reported a recent timer, fresh healthy watchdog and three retained discovery replays verified, with no provider calls made by the check. Preview evidence: `.tmp/attention-reward-lab.png`. Local collection continues under its existing budgets and source backoff.

Commands (all local):

```powershell
pnpm --dir discovery typecheck
pnpm --dir discovery test
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
# From discovery/:
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
# From repository root:
pnpm exec tsx scripts/check-attention-local.ts
pnpm exec tsx scripts/check-discovery-operations.ts
git diff --check
```

Next independent attention milestone: authenticated submission/moderation records, URL deduplication and explicit authorship/metric-verification gaps, without inventing social API evidence or live rewards. Production reward settlement additionally needs approved D11/D12 rules, verified content and cutoff snapshots, ownership/Sybil review, immutable real entitlement accounting and claim security. Independently complete wallet history/historical USD for P6 and ten eligible discovery contenders remain open.
