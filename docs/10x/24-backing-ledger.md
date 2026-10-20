# Prospective backing ledger and scoring experiments

Follow-on milestone: [retained cutoff evidence and pre-trade provider references](25-cutoff-history-and-price-references.md). The description below records the original v1 foundation; new journal-enabled rehearsals use v2 and no longer reconstruct cutoff risk from the mutable candidate table. Historical USD remains unverified and all outcomes stay withheld.

Implemented locally on 20 October 2026 for PRD §§5.1–5.3 and 17.2. This is the P6 foundation after [signed Solana ownership](23-solana-identity.md). It is a diagnostic rehearsal, not an eligible-vote ledger or approved election. All outcomes are withheld, every winner is null, and votes/rewards/transactions remain disabled. The founder's free-first, local-only, unchanged-gates and no-deploy instructions control this work.

## What the local operator can review

`/backing` shows the latest ten prospective windows, frozen counts, aggregate token projections, trade hold-reason counts, hashes and gaps. `/admin/10x` adds a backing experiment lab using the existing in-memory operator token. The operator can open one window, freeze it only after its fixed source deadline, replay its exact retained transactions, inspect instruction-level ledger entries and download its evidence. Wallet/identity membership and raw transactions are protected; public summaries expose counts and aggregate projections only. No wallet signature, outbound buy or user-key access occurs in this flow.

Opening freezes up to twenty observed contenders, the entire active discovery policy, and current signed wallet links before trading begins. The scope includes ineligible contenders so missing evidence is visible; inclusion never creates eligibility. All creation/graduation, age, holder, concentration, wallet/funding and freshness gates must pass at both opening and cutoff before a group can have a nonzero experimental projection. No caller can supply an alternative policy or turn a gate off. Source timestamps after opening are rejected before admission. Missing, stale or post-cutoff closing snapshots fail closed; the current mutable candidate table cannot recreate missing historical risk observations.

The window is `[start,end)`, lasts an explicit 1–1440 minutes and has a fixed source deadline five minutes after end. Existing local maintenance automatically freezes one due window per tick, without provider requests. A sleeping workstation resumes later without extending the deadline or backfilling future evidence. Opening is manual and authenticated; no automatic daily participation or new remote scheduler was added.

## Trade evidence and attribution

The ledger reads the existing mainnet RPC transaction cache populated through `getTransaction` with `commitment: finalized`. This is collector provenance from finalized RPC responses, not an independently verified finalized-slot watermark or cryptographic finality certificate. Existing certified Pump/PumpSwap account/signature-role/transfer decoding is reused, including temporary WSOL lifecycle checks. Only supported native-SOL/WSOL paths are interpreted.

Each retained body is schema-checked, hashed, bound to its primary signature and checked for block/fetch times. Its source fetch must be inside the opening/deadline range and its block time inside the trading window. The bounded query first reads metadata, then loads at most 100 bodies within 750 KB; unrelated old funding history cannot consume this body allowance. Truncation is explicit and never treated as complete election coverage. A malformed body/hash fails settlement and retains a visible error rather than bypassing verification.

Decoded entries identify mint + signature + instruction path, with transaction hash, signer wallet, slot/time, side, measured base/quote transfers and hold reasons. Repeated transaction bodies are rejected; repeated instruction paths cannot silently conflict. Multiple instructions remain separate. Current holdings are not purchases. Transactions outside the window, failed/unsupported transactions and post-deadline arrivals supply no projected credit.

Signed membership is read with an identity-audit watermark and atomically admitted only if membership has not changed during opening. Wallets must already be linked at opening; later links cannot claim earlier buys. Wallets unlinked through the source deadline are held. Multiple addresses under one frozen identity share one token/window cap. Replays use frozen membership, not current links, and retain old associations after source tables change. This is key ownership, not proof of one person or common beneficial control.

## Explicitly hypothetical scoring

D07 remains unresolved. Each opening requires an assumed integer USD/SOL rate, minimum trade/net-purchase amount and identity/token cap. The review example uses **$100/SOL, $1 minimum and $100 cap**, solely as hypothetical inputs. These are not market observations, recommended thresholds, approved voting policy or verified historical USD valuation.

Two deterministic comparisons are retained: sum of capped positive hypothetical net USD per identity, and sum of each identity's square-root-weighted capped value. Integer lamports/micro-USD arithmetic and integer square roots avoid floating-point scoring drift. Both are experimental units; neither selects a winner. There is no daily cross-window cap or cross-chain normalization yet.

For a group, qualifying buys add measured quote value; every observed sell subtracts, including sells of old holdings. Splitting buys below the minimum creates no projected value. Nonpositive net token purchases, insufficient positive net quote value, same-transaction round trips, unexplained token balance changes, missing quote amounts, incomplete decoding, missing/revoked membership and candidate gate failures hold the group. Relevant observed/heuristic funding and coordination signals also hold an experimental group; they do not establish fraud and do not alter discovery eligibility. Unknown transactions or missing reversals outside the cache remain a fundamental gap even if a projection is nonzero.

## Immutability, quotas and retention

Local migration `0019_backing_rehearsal.sql` stores one immutable opening and its eventual evidence/result. Admission allows one open window and twenty openings per UTC day. UUID retries return the original opening; conflicting reuse fails. Unique admission, frozen update and associated audits use D1 transactions. Racing finalizers retain one result/audit. A failed freeze keeps the window open with a visible error; a signed cancellation/recovery UI is not implemented yet.

Opening/evidence/result budgets are 650/950/250 KB respectively, below a combined 1.85 MB before small metadata, leaving room under D1's 2 MB row limit. Oversized snapshots fail rather than silently remove candidates or alter gates. Only the explicitly bounded transaction scan may truncate, with a gap flag. This does not certify future remote storage/CPU usage. Local records currently have no retention purge.

Opening, evidence, output and record hashes plus the algorithm version are retained. Full authenticated replay verifies hashes and re-runs transaction decoding and projections from saved bodies; it makes no RPC calls and ignores later changes to candidate, identity and transaction caches. Public reads check stored opening/output/record hashes without re-decoding transactions per visitor. Decoder/protocol changes require versioned replay support; this milestone reuses the current pinned decoder and does not implement automatic historical decoder migration or chain-rollback repair.

API contracts are generated in `discovery/openapi.json`:

- `GET /api/10x/backing`: public aggregate summaries only.
- `POST /api/10x/admin/backing/open`: strict request with UUID, reason, duration and hypothetical assumptions.
- `POST /api/10x/admin/backing/freeze`: operator request after the fixed source deadline.
- `GET /api/10x/admin/backing/:id`: protected evidence and verified full replay after freezing.

Local runtime and existing operator authentication/origin/body bounds still apply. No provider budget, evidence policy, identity session, launch authority or deployed route was changed. This module has no transport for external sources.

## Validation and remaining PRD work

The full discovery suite passed **256 tests across 28 files**, including **sixteen backing tests** for decoded buys/sells, linked-wallet caps, net reversals, minimum-sized buys, old holdings, exact cutoff boundaries, missing quotes, link revocation, shared-funder flags, ineligible/future evidence, duplicate signatures, source hash tampering, exact integer results, nontrade transfers, round trips, source bounds, concurrent opening/freezing, immutable retry, replay after cache changes, protected reads/writes and locked request schemas. Positive projection cases use isolated synthetic instruction fixtures. Discovery/app typechecks and app build/performance checks pass. Migration applied locally only. The live local timer/watchdog and the three older discovery rehearsal replays remain healthy.

Local review `c6df4223-52e1-4bc7-aed8-b55084b37291` opened at 11:07:18.910 UTC with twenty observed contenders, **zero eligible at opening and zero signed linked wallets**. Trading ended one minute later and the source deadline remained 11:13:18.910 UTC. The existing timer automatically froze it; the read-only checker independently verified the retained replay and protected evidence returned 401 without the operator token. This run contained zero decoded instructions and zero identity/token groups, so it does not validate positive participation on live data. It cannot produce live backing. The review script records its ID in ignored `.tmp/backing-local-review.json`. No synthetic wallet links or trades were inserted into the live database, and the check made zero provider calls.

The frozen public summary was visually checked through the existing HTTPS tunnel. An intermittent app-bootstrap loading stall cleared after restarting only the local Vite process on port 5183 with its local API target at 8790; the discovery Worker/timer/tunnel were preserved. The account API still returned 200, and the independent discovery watchdog remained healthy. No browser wallet, login or operator token was entered during UI checks.

```powershell
pnpm --dir discovery typecheck
pnpm --dir discovery test
pnpm --dir discovery test -- src/backing.test.ts
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-backing-local.ts --open # explicitly open one local example if none is open
pnpm exec tsx scripts/check-backing-local.ts        # read/verify only; zero provider calls
pnpm exec tsx scripts/check-discovery-operations.ts
```

Next P6 work is certified election-window completeness and an independent finalized-slot watermark, retained cutoff risk/membership revisions, verified contemporaneous USD valuation, historical decoder/reorg handling and stronger wallet/funding anti-manipulation validation. Compare D07 choices on frozen evidence before approving any live score. Ten eligible recent discovery tokens remains an unmet target; this module neither improves source coverage nor relaxes a gate. Exact three-pool simulation and all launch/reward/treasury release decisions remain separate outstanding work.

Primary references reviewed: [Solana finalized transaction requests](https://solana.com/docs/rpc/http/gettransaction), [D1 batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [Workers practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
