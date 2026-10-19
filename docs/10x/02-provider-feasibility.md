# Provider feasibility and free-first budget

Primary documentation checked during 19–20 October 2026 (Sydney). This is a documented feasibility review, not an executed endpoint-load test or a legal clearance. Recheck terms and quotas before enabling an adapter.

## Market data

**GeckoTerminal / CoinGecko — partially verified.** The original [GeckoTerminal Swagger page](https://api.geckoterminal.com/docs/index.html) is JavaScript-only to the research reader; the former API guide redirects to CoinGecko documentation. Current [Demo endpoint overview](https://docs.coingecko.com/demo/reference/endpoint-overview) lists per-network new/trending pools and multi-pool reads. The [new-pools endpoint](https://docs.coingecko.com/demo/reference/latest-pools-network) covers 48-hour **pool** creation, up to 20 pools/page with restricted deeper pagination, and nullable unverified market caps. Neither token age nor graduation follows from that result. These docs describe the keyed CoinGecko Demo product; do not silently apply its quotas to the legacy keyless GeckoTerminal API.

The PRD's approximately 10 requests/minute and one-minute cache for the legacy API are **unconfirmed** here. Start with an internal ceiling below that hypothesis, but verify actual endpoint response/cache/429 behavior and published legacy limits before unattended ingestion. [GeckoTerminal terms](https://www.geckoterminal.com/terms-conditions) incorporate separate API terms. [CoinGecko API terms](https://www.coingecko.com/en/api_terms) make scope plan-dependent, restrict API redistribution and require attribution. Record license scope, attribution, retention and derived/public-data use per adapter; free access does not itself resolve these questions.

**DEX Screener — technical capacity verified, product permission unresolved.** Its [API reference](https://docs.dexscreener.com/api/reference) documents `/tokens/v1/{chainId}/{tokenAddresses}` for up to 30 addresses, 300 requests/minute; profile/boost APIs have lower limits. Its [API terms](https://docs.dexscreener.com/api/api-terms-and-conditions) permit commercial use subject to restrictions, prohibit directly competing primary purposes and restrict unauthorized availability to third parties. Do not conclude either blanket permission or blanket commercial prohibition. Keep adapter disabled for production until the specific 10X display/derived-ranking/retention use is assessed or permission secured. Paid boosts are not quality signals.

For 100 Solana assets: `ceil(100 / 30) = 4` requests/minute, `5,760/day`, `172,800/30 days`, before retries. Partition by chain: with 25 assets on each of four chains this is also four calls; with 97/1/1/1 it is seven. The cap is global, so budgeting `4 calls × every chain` needlessly overstates the default workload. All visitors share one refresh. Each snapshot retains source observation time separately from fetch time.

## Origin and graduation

The [official Pump program documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md), [PumpSwap documentation](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_README.md) and [canonical-pool description](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_SWAP_CREATOR_FEE_README.md) support verifying Pump creation and migration to canonical PumpSwap pools. A bonding-curve `complete` flag is insufficient proof of a successful migration.

Implementation must pin program IDs and IDL/revision, decode successful finalized creation/migration transactions and inner instructions, validate derived pool/authority accounts, match both mints and verify initialized pool reserves. Store slot, block time, transaction signature, instruction/event index and raw evidence hash. Current and legacy instruction versions require separate fixtures. Public RPC history/truncation/retention is a coverage constraint, not evidence that an absent event never occurred. Other launchpads/chains remain **unverified** until their own adapters pass equivalent checks.

## AMM feasibility

The [Meteora launch-pool guide](https://github.com/MeteoraAg/docs/blob/main/user-guides/creating-a-liquidity-pool.mdx) documents single-sided base-token deposits and selectable fee/start/lock configuration. The [DAMM v2 reference program](https://github.com/GormeteoraAg/damm-v2) describes price ranges, separately claimable fees and permanent position locks. These support a prototype; they do not prove the proposed three ATTN pools, arbitrary OG/$10X quote-mint combinations, exact quote-only receipts or beneficiary restrictions. Pin code/SDK, check accepted mint extensions and token orientation, and prove each on devnet. Do not substitute a DBC migration lock setting for a direct DAMM v2 lock policy.

For EVM evaluation, [Uniswap concentrated-liquidity documentation](https://developers.uniswap.org/docs/get-started/concepts/liquidity-providers/concentrated-liquidity) describes ranges, inactive liquidity and inventory becoming one asset. **Inference:** v3-style positions merit evaluation for ATTN-only initialization. This does not prove quote-only fees, permanent locks, immediate tradability at the boundary, or deployments on Base/BNB/Robinhood. Verify deployed factories, locker capabilities and fee rights per chain; no EVM launch adapter is certified now.

## Cloudflare capacity

| Service | Current documented allowance | Consequence |
|---|---|---|
| [Workers](https://developers.cloudflare.com/workers/platform/pricing/) | Free 100K requests/day, 10ms CPU/invocation; Standard starts at US$5/month | Free prototypes need measured CPU; heavy verification may need chunking or a paid plan |
| [D1](https://developers.cloudflare.com/d1/platform/pricing/) | Free 5M rows read/day, 100K rows written/day, 5GB total | Index writes count; minute-by-minute per-asset history exceeds write quota |
| [Queues](https://developers.cloudflare.com/queues/platform/pricing/) | Free 10K operations/day; 24h retention; typical delivery uses three operations | Batch jobs; preserve durable outbox for recovery beyond retention |
| [Workflows](https://developers.cloudflare.com/workflows/reference/pricing/) | Free 3K steps/day; 1GB-month storage; requests shared with Workers | Do not use a many-step Workflow per minute per candidate |

Account-wide allowances are shared with the repository's other apps. This is not a claim of available headroom on the user's account. No Cloudflare subscription was purchased or changed.

## Proposed resource model (estimates)

Assumptions: 100 live Solana candidates; 30-day month; 10K public API reads/day; one scheduler tick/minute; discovery new+trending every five minutes; up to 100 new proof investigations/day with at most 20 RPC requests each. These are load-model inputs, not verified demand or guaranteed coverage.

- Scheduler: `1,440` invocations/day. Discovery: `2 × 288 = 576` market calls/day before pagination. Discovery pagination and burst admission have independent daily caps; omitted pages mean incomplete coverage and must be shown.
- Pricing: 4 batched market calls/minute if licensed/available. One batched queue message/minute is about `4,320` operations/day before retries; discovery every five minutes adds `864`; a bounded 1K-operation reserve leaves roughly 3.8K for other jobs. A message per token/minute would cost `432,000` operations/day and fails the free model.
- Proof budget example: 2K RPC calls/day; checkpoint and defer after exhaustion. A public RPC endpoint is not an archival indexer/SLA. No promise of exhaustive Solana discovery at $0.
- D1: 100 × 1,440 = **144K rows/day** just for minute snapshots, excluding indexes. Instead publish one bounded JSON read-model row/minute (1,440 writes), archive five-minute sampled per-asset metrics (28,800 rows/day before indexes), and retain critical proofs/policies as immutable records. Measure actual `rows_written`, cap well below account limits, downsample if necessary. Keep full-resolution immutable election inputs when voting exists.
- At a hypothetical 1KB/metric row, five-minute samples are roughly 864MB/month before indexes. Use retention/rollups and R2 exports only where the data license permits. One 100KB compressed minute snapshot would be about 144MB/day, so retaining everything indefinitely is not a free storage plan.
- Voting later: 1K trade events/day batched in groups of 100 adds roughly 30 queue operations before retries; append/index writes need separate measured capacity. Ten campaigns × one daily settlement each is ten settlement jobs/day, not ten launches/day. At 20 workflow steps each this is 200 steps/day, before fraud processing and claims. User count and reward throughput are unknown; no unlimited-free reward promise.

Local development adds no deployed hosting resource. A low-traffic free prototype is plausible if measured CPU, storage and account headroom fit. A paid Workers baseline would be approximately US$5/month before other services, but **the selected approach remains free first**, with no automatic upgrade. RPC/archive data, market licensing, signer service, audits, gas, rent and liquidity capital are separate unknown costs. Show stale/partial status, reduce sampling or pause ingestion instead of silently exceeding approved spend.
