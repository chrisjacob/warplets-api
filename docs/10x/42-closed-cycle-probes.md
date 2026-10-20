# Independent closed-cycle launch probes

21 October 2026. Advances PRD §§6.3 and 18 / P7 after [funded two-leg routes](40-funded-routes-and-ordering.md). The PRD requires cross-pool arbitrage under changing external OG/$10X rates. This delivers **independent alternatives from one frozen baseline**, not a sequential market-path or executable arbitrage simulator. User instructions remain controlling: free services, local only, unchanged evidence gates, commit/push, no deployment.

## Implemented

`/launch-lab` defaults to v4 closed-cycle probes. Original v1 net, v2 fee and v3 race/no-race presets remain available. A browser calculation uses zero provider requests. Existing authenticated local save/replay endpoints retain immutable inputs, deterministic results and hashes; the existing shared twenty-new-runs/UTC-day quota and request/record bounds cover all four versions.

Each scenario contains a v3 funded baseline with at most eleven ordered actions, and one to eight independent probes. Each probe appends one hypothetical quote → ATTN → another quote route to a **copy** of that baseline. Both route legs use the frozen v3/v2 engines and actual net intermediate receipts. Trader funding, pool capacity, minimum receipts, separate fees and u64 inventory bounds remain enforced. All traders still start with zero ATTN; the original 50/20/20/10 allocation and campaign reserve remain intact.

The final external conversion returns the other quote asset to the starting quote asset. It assumes an explicitly supplied constant-product venue with positive raw reserves and a fee between 0 and 9,999 bps. This is an algebraic toy venue, **not a certified implementation of any external AMM or a price feed**. Its input fee rounds up; output rounds down:

```
fee = ceil(route_receipt × fee_bps / 10,000)
net = route_receipt - fee
returned = floor(net × reserve_output / (reserve_input + net))
```

Input fees stay in the hypothetical external reserve. Reserve-input-plus-gross must fit u64. Fee-consuming input, zero receipt and capacity violations fail closed. Every probe names its own reserves: changing their ratio changes the external price assumption, while reducing their size exposes finite-depth slippage. No infinite-depth or free conversion is assumed.

Before quoting, the trader must hold the explicit native network-cost allowance in addition to the route's gross native input, when applicable. After quoting, guards check the final starting-asset receipt and the exact profit after modeled network costs. For a starting quote asset with decimals `d` and assumed native value `n / q`:

```
profit_native_raw = (returned - starting_input) × n × 10^9 / (q × 10^d)
                    - network_cost_native_raw
```

This is retained as an exact signed rational. Comparisons use that rational; the displayed raw-native integer floors negative fractions too, avoiding an understated loss. Non-native profit conversion uses the scenario's **assumed opening** quote/native reference, not an observed price or executable native liquidation. Projected successful balances change only the starting quote asset and the explicit native cost. ATTN and intermediate quote inventory return to their baseline levels.

**No probe advances baseline pools, traders, steps, fees or another probe.** `probes_apply=false`; rejected guards have no projected final balances. Successful route fees and external fees shown inside a probe are projections, excluded from the baseline accrual totals. Even a passing quote applies no trade or cost. Failed-transaction gas, actual atomic execution and sequential competition are not modeled.

## Example and local evidence

All examples are toy amounts, not proposed launch parameters. From the same baseline and 100-unit native starting input:

| Alternative external condition | Returned native units | Projected native profit after explicit cost | Guard |
|---|---:|---:|---|
| Unit-rate reference | 98.156552250 | -1.848447750 | Fails profit minimum |
| Higher OG/native reserve ratio | 147.234828375 | 47.229828375 | Quote passes |
| Lower OG/native reserve ratio | 49.078276125 | -50.926723875 | Fails profit minimum |
| Same higher ratio, thin reserves | 74.305956739 | -25.699043261 | Fails profit minimum |
| Higher ratio, large network cost | 147.234828375 | -52.765171625 | Fails profit minimum |

The usual assumed network cost is 0.005 native units; the last alternative assumes 100. The apparent margin can disappear through depth or costs. No projected margin is realized profit or evidence of a live opportunity.

Local saved rehearsal **`ab3792c4-cdce-45bb-a77b-5a2101b255c4`** saved, retried and replayed identically. All three earlier server records retained their original hashes. Original v3 record `9c219070-2ef3-4dba-b45d-4418db3df38d` is now an offline fixture alongside v1/v2. Full retrieval without a token returns 401; public summaries omit inputs and review reasons. Default policy and disabled launch/signing/reward capabilities were checked unchanged. The smoke script made **zero source/provider requests**.

## Verification

- **537 discovery tests across 41 files passed**, including 28 cycle cases. Coverage includes independent forks, actual net receipts, external integer rounding/invariant, network funding, first/second-leg failures, receipt/profit minima, reverse OG/$10X starting cycles, signed fractional conversion with mixed token decimals, overflow, malformed inputs, immutable replay/tampering, shared admission and authenticated/local/origin guards.
- Maximum eight traders, eleven successful two-leg baseline actions and eight probes remain within existing 30 KB normalized request / 150 KB input-plus-result caps. Schema bounds cap each scenario at eleven baseline actions and eight probes, each with at most two additional route legs.
- Discovery/app typechecks and app build passed. Home startup remains 233.9 KiB gzip, within budget. The lazy lab chunk was 49.53 KB / 14.46 KB gzip.
- Browser review through the existing local tunnel verified positive and negative projections, all five guard outcomes and explicit assumption disclosures. The narrow-screen table keeps outcome and profit together; full details retain reserves, fees and exact profit fractions.
- Local security smoke checks passed: 15 private-file requests denied, ten admin origin/body checks, public routes available and signed action sessions required; zero source requests.
- No new endpoint, migration, dependency, provider, timer, signer, spending permission or policy rule was added. OpenAPI retains 77 paths, with an additional versioned schema branch.

Useful commands from the repository root:

```powershell
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-launch-cycles-local.ts
node scripts/check-tenx-security-local.mjs
git diff --check
```

The smoke script reuses its saved UUID/request in ignored `.tmp/launch-cycles-local.json`; it does not refresh discovery data.

## Remaining work

Independent reserve alternatives are not sequential arbitrage, quote replenishment or a changing chronological external market. Actual external DEX math/configuration, trustworthy timestamped reference prices, executable native valuation, transaction failure costs, dynamic/opening fees, rate limiters, lock/fee ownership proofs, launch recovery and devnet receipts remain open. D08–D10/D14–D16 are unapproved. No launch economics, treasury authority, fee entitlement or financial action is approved by these experiments.

The ten-eligible-token discovery target remains unmet; this milestone claims no funding coverage or eligibility gain. No deployment, onchain transaction, spending or reward settlement occurred.
