# Fees, price behaviour and coverage-first collection

20 October 2026, Australia/Sydney. The user confirmed that **all current evidence gates must remain in place** and requested fee/organic-price evidence alongside coverage improvements. This change is local only, within the existing free request ceilings. No deployment, paid plan, migration, new credential, signing or broadcast.

## Implemented behaviour

Token pages include **Fees & price behaviour**, backed by `/api/10x/activity/solana/:address`. This endpoint replays the saved wallet evidence and reads up to 1,000 market observations from the last 24 hours. It makes zero provider requests and does not change eligibility, recommendations or frozen historical evidence.

Network fees come from `meta.fee` in saved finalized successful transactions containing a verified canonical swap for this token. Each transaction is counted once even when several swaps are verified. Creation-only transactions, failed swaps and unverified swaps are excluded. Values stay in integer lamports and display as SOL; no current-price USD conversion or extrapolation to lifetime/24-hour totals. Fees belong to the entire transaction, which can contain other token swaps/actions. Pump/PumpSwap protocol trading fees and LP fee revenue remain explicitly unknown.

The panel shows sampled fee-payer count/concentration, buyers/sellers, round trips and shared-funder buyers alongside price observation counts, up/down/unchanged steps and the largest comparable step. Missing/nonpositive prices, duplicate observation times, source changes and gaps above 30 minutes break price comparisons. An end-to-end sampled return is withheld across discontinuities. Future observations are excluded and stale sample timestamps remain visible. These are provider observations, not complete execution-price history.

**Organic trading and volume authenticity remain unverified.** Bots can pay real fees and produce price changes. Fee amounts, distinct wallet addresses or a moving chart do not certify independent traders, fee payer beneficial ownership or natural demand. The existing wallet/funding/holder evidence remains necessary. No organic/bot score or new eligibility threshold was selected. Historical research retains `fees_produced_usd=null`; network fees do not fill protocol revenue. Existing wallet analysis/research/election schemas and replay rules remain unchanged.

## Coverage improvements

- Reuse prior v4 finalized bonding-curve pages only when the evidence root hash, token/pool identity, independent creation proof and successful finalized creation reference match. Preserve original page timestamps. Incomplete history is fetched again; no cached page is relabelled as fresh. Recent pool history still comes from the source on each collection pass.
- Spend up to the existing 18-call wallet ceiling on direct pre-buy scans before expanding second-hop work. The second-hop collector uses remaining calls and retains checkpoints. Previously four calls were reserved for second hop even while the direct evidence required for eligibility was incomplete.
- Choose due promising contenders by oldest attempt, using liquidity priority to break ties. Newly eligible-for-investigation contenders therefore receive turns instead of repeated high-liquidity work consuming all turns. All current potential-candidate checks, per-address retry delays, pause, leases, daily quotas and provider cooldowns remain in force.

Some coverage gaps cannot be resolved by replay: provider-ended history, unsupported bodies, the three-page/twelve-transaction funding bounds and unavailable price periods stay visible. The target of ten fully eligible tokens is still unmet. No missing evidence was waived.

## Observed local evidence

At 04:41:46 UTC, the cached activity API returned 200 for mint `DHPxVtGgEyNFWXoN5D2vMTcZXybxxTr8VqLgegNpump`: eight verified swap transactions/trades, **133,896 lamports** total network fees, three distinct fee payers and 50% of sampled transactions paid by the largest payer. The wallet sample was observed at 04:21:34 UTC. Sixteen positive price observations supplied eleven upward and three downward comparable steps, with one discontinuity; continuous sampled return was withheld. Organic activity and protocol/LP fees remained unverified. This is a bounded saved sample, not an asset endorsement, verified reported volume or complete fee total.

At browser verification, the Discover view still showed zero eligible and ten provisional tokens. Ten passed the fresh non-wallet gates at that moment; unfinished wallet history continued to block them. Counts and freshness change with subsequent observations.

One bounded local collection pass for previously unanalysed Potions (`EDAopv9x9ki5gedvTfrDCgF9ThmfpPN4BvLwrPUXpump`) succeeded using 16 RPC calls inside the unchanged allowance, recording evidence hash `7e0dc39c6ad903b1aa703566a903e7ca35fb9243582e2b083926e21203e5b28f`. It found one verified buy and remained blocked by sample/coverage gates. No signal in that sample is not a safety finding.

## Files, configuration and validation

New backend files: `discovery/src/{activity-model.ts,activity.ts,activity.test.ts}`. Updated wallet collection, Worker routes and service tests. Updated UI/client and shared-contract watcher, generated OpenAPI and its generator, operating guide and decision/index docs. No new settings, dependency, database migration or API allowance; global RPC 5,000/day, wallet 800 within that cap, quality 1,800 within that cap and market 600/day remain unchanged. Existing local automation picks up the Worker changes; the Node relay/timer did not change.

Commands:

```powershell
pnpm --dir discovery typecheck
pnpm --dir discovery test -- src/activity.test.ts src/service.test.ts
pnpm --dir discovery test
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm --dir app test
pnpm --dir app build
pnpm exec tsx scripts/check-discovery-local.ts
pnpm exec tsx scripts/check-discovery-elections.ts
git diff --check
```

Targeted tests passed: 36, including fee deduplication across multiple swaps, failed/unverified exclusion, evidence tampering/asset identity, price discontinuities/future samples, cached public reads with no fetch, creation-history reuse and fail-closed cached-evidence corruption. Full discovery suite: **149 passed**. App: **773 passed**, type checks/build/performance budget passed. Local smoke checks replayed four paired origin/migration proofs, four account snapshots, three holder inventories and three wallet analyses, with unauthorized admin access returning 401. Three current/legacy elections independently replayed as verified. Smoke/replay scripts made zero provider requests. Browser verification displayed the fee values, price discontinuity and unverified-organic label.

Next: continue resumable direct funding collection and separately certify protocol-fee attribution from canonical Pump/PumpSwap execution evidence. Add further bot-activity hypotheses only after measuring coverage and validating against daily outcomes; keep automatic policy activation disabled.

Primary sources checked: [Solana fees](https://solana.com/docs/core/fees) describes base and optional priority fees; [getTransaction](https://solana.com/docs/rpc/http/gettransaction) exposes transaction metadata including `fee`. A network fee does not establish a token's LP/protocol revenue. [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) informed the local binding/awaited-request implementation.
