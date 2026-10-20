# Prospective wallet-window coverage and RPC finality observations

Local P6 / PRD §§5.1–5.3 continuation, 20 October 2026. New backing rehearsals now collect the frozen signed wallets' recent history during the fixed source grace period, retain a source-coverage manifest and withhold experimental projections when that bounded history is incomplete. This follows [cutoff snapshots and price references](25-cutoff-history-and-price-references.md). Discovery eligibility, free provider caps, hypothetical pricing and the no-live-votes/no-deploy boundary are unchanged.

## Collection scope and scheduling

Migration `0022_backing_window_index.sql` adds a durable per-run collector state/lease and a separate daily reservation counter. Existing local maintenance runs the collector after trading ends and before the original end-plus-five-minute source deadline. It does not extend that deadline or backfill a missed window after sleep. No automatic opening, new remote cron, new identity or wallet signature is introduced.

The collector tracks the first sixteen frozen Solana wallet addresses in canonical address order. More frozen members create an explicit scope-limit gap, holding projections. It scans the **wallet addresses**, so outgoing sells and unrelated activity are observable alongside buys; it does not rely on mint-address transaction history or current holdings. It only reads public RPC methods. The existing certified Pump/PumpSwap decoder still determines which retained instructions are supported purchases/sales.

A qualifying RPC observation requires a mainnet genesis check, `getSlot(commitment: finalized)` and `getBlockTime(slot)` whose estimated block time reaches cutoff and is no later than receipt. The configured RPC URL is hashed into this observation; changing it mid-window holds collection. Subsequent history requests use `commitment: finalized`, `minContextSlot` equal to that slot, fifty references per page and the previous last signature as `before`. Each tick processes at most two work items after any required root observation, with a hard maximum of four RPC attempts.

History must reach a reference with a known nonnegative block time strictly before the opening. A short or empty archival page alone never counts as reaching that boundary. Cursor replay, duplicate/reordered references, changed page hashes or body slot/time/signature mismatches fail validation. Unknown/nonfinalized/nonmonotonic timestamps, signatures above the finalized observation, missing bodies and inventory limits remain visible gaps. Unsupported/null transaction responses are retained as unavailable and are not retried indefinitely within that window.

The collector retains at most sixteen pages and processes at most one hundred unique in-window successful transaction references. Correctly hashed cached bodies are reused. Fresh bodies are fetched with finalized commitment, checked against signature/slot/time and the indexed wallet's account-key reference, then cached atomically with collector progress. Oversized bodies remain unavailable. State is limited to 240 KB; source evidence still shares the existing 950 KB final snapshot budget. Oversized settlement fails visibly rather than dropping required evidence.

## Free budgets and recovery

The daily backing subset is `min(160, floor(wallet_daily_limit / 5))`: **160 of the existing 800 wallet calls** in the current local configuration. Every attempted source call must reserve backing, per-run, wallet and global quota before transport. The maximum per run is 64, with four attempts per tick. This is a subset of existing allowances, not an extra 160-call entitlement. Data status displays the backing subset's usage and cap. Reservations denied by a later gate may conservatively consume an earlier counter; they never create extra allowance.

No linked wallets, disabled wallet analysis, pause, shared RPC backoff or a passed deadline produces no transport call. A provider 429 persists shared backoff. A ninety-second per-run lease is checked before each reservation/advance; a replacement owner cannot be overwritten by a stale worker. Progress and cache writes are fenced. A late response does not advance source evidence or extend the deadline. Normal source misses/errors hold the rehearsal and do not stop discovery reviews or reset provider controls.

No new environment variable is required. `TENX_WALLET_ANALYSIS_ENABLED`, the existing wallet/global limits, pause and backoff govern collection. New openings freeze `source_evidence_version: wallet-window-v1`. Existing openings without that flag are never enriched retroactively. Total local retention has no purge yet; future remote D1 storage/CPU/query budgets remain uncertified.

## What the manifest proves and does not prove

The frozen private record includes the RPC root/time observation, page address/cursor/min-context/fetch times, exact normalized reference rows and their hashes, unavailable/processed signatures, reserved-call count and final collector error. Replay recomputes coverage from these inputs and retained bodies, without network requests. Public summaries expose aggregate counts and gaps; they expose no wallet membership or signature list.

New `backing-experiment-v3` records classify coverage as `rpc_window_covered`, `incomplete` or `no_linked_wallets`. The first label means that the bounded, provider-reported histories reached their required time boundary and supplied all required bodies. It **does not mean independently exhaustive election indexing**. The RPC can omit archival history; block times are estimates; `minContextSlot` is a minimum node context, not a historical upper-slot filter. A single provider's finalized response is not a cryptographic or independently checked finality certificate. These limitations remain in every manifest, including a covered one. Winners remain null and votes/rewards disabled.

If bounded coverage is incomplete, every decoded group gains `wallet_window_coverage_incomplete` and receives zero experimental projection. Cached transactions outside the index are still inspectable as diagnostic entries but cannot establish coverage. A known cached reference to a frozen member that is absent from its history holds coverage; unrelated wallets in the shared cache do not invalidate otherwise covered member histories. Indexed bodies are prioritized within the existing hundred-body/750 KB source scan. Candidate creation/graduation, age, holder/concentration, wallet/funding and freshness gates still run unchanged. Even a nonzero covered projection retains hypothetical USD assumptions and no live credit.

V1 and V2 openings/results retain their original algorithms and field order. Optional schema fields have no defaults. Neither old records nor their hashes are rewritten. The operator's replay/download includes the full new manifest; `/backing` shows aggregate history boundaries/body coverage/finality gaps, and `/status` shows budget use. Public visits cause zero provider requests.

## Validation and working-data result

The discovery regression suite passed **285 tests across 29 files**, including seventeen index tests and twenty-eight backing tests. The final index tests passed again after malformed execution-status handling. Discovery/app typechecks and app build/performance budget pass. New isolated tests exercise complete bounded histories, unknown/short/empty pages, archival misses, cached reuse/hash conflicts, root timing/wrong clusters/provider changes, unsupported responses, late arrivals, races/lease loss, all four quota limits, 429 backoff, page tampering, source/body/address mismatches, unrelated cache activity, sixteen-wallet/page boundaries and V3 scoring holds. Positive coverage/trades use isolated synthetic fixtures. Three local relay tests pass for read-only allowlisting, safe-slot validation and rate limiting. No real wallet signature or synthetic live membership/trade was used.

Working-data run `aa338b3d-a790-432e-b2d2-c1cff2525be3` opened at 11:57:24.972 UTC and froze automatically after its fixed 12:03:24.972 deadline. It contained twenty contenders, **zero eligible contenders, zero linked wallets, zero pages/trades and zero backing RPC reservations**. Its manifest correctly reports `no_linked_wallets`, no root observation and unverified independent finality. It verifies scheduling, no-call behavior and retained replay, not positive live source coverage. Its V3 replay and the prior V2/V1 records independently matched saved hashes. Three older discovery rehearsal replays also verified.

The migration was applied with `--local`. To load the added read-only `getBlockTime` relay method, only the verified discovery launcher PID 7096 and its descendants were stopped under its existing supervisor. The supervisor started replacement PID 44388; local D1, quotas, backoff, the tunnel and other apps were preserved. The post-restart timer/watchdog and existing replays checked healthy. New signed-wallet collection has not been exercised with a real extension, since the working database has no linked signed wallets.

The new wallet-window panel and expanded source gaps were visually verified through the existing HTTPS tunnel. Review screenshot: `.tmp/backing-wallet-window.png`. No operator token, wallet extension, signing request or user login was entered during UI verification.

The final operational check still had a recent timer and fresh independent watchdog, with all three discovery replays passing. Wallet research reported an actual `rpc_unavailable` source error and was in backoff until 12:20:12.876 UTC. That source gap was preserved rather than forcing a retry or changing allowances; it does not affect the already frozen zero-participation V3 record. Healthy scheduling is not evidence of healthy upstream coverage.

```powershell
pnpm --dir discovery typecheck
pnpm --dir discovery test
pnpm --dir discovery test -- src/backing-index.test.ts src/backing.test.ts
node --test scripts/discovery-relay.test.mjs
pnpm --dir app typecheck
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
# From discovery/:
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
# From repository root:
pnpm exec tsx scripts/check-backing-local.ts --open
pnpm exec tsx scripts/check-backing-local.ts
pnpm exec tsx scripts/check-discovery-operations.ts
git diff --check
```

Next P6 work: independent finalized-chain verification and rollback handling, certified contemporaneous historical USD, stronger membership/Sybil revisions and completeness beyond bounded RPC history. D07 still needs approval before live scoring. The ten-eligible-recent-token discovery target remains unmet; no evidence gate or threshold is relaxed here. No deployment, paid plan, mint, transaction, social post, reward or signer authority is introduced.

Primary references: [Solana getSlot](https://solana.com/docs/rpc/http/getslot), [getBlockTime and estimated production time](https://solana.com/docs/rpc/http/getblocktime), [address signature history](https://solana.com/docs/rpc/http/getsignaturesforaddress), [finalized transaction requests](https://solana.com/docs/rpc/http/gettransaction), and [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
