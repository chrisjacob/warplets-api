# Three-pool net curve lab — local foundation

21 October 2026. Implements the first mathematical slice of PRD §§6.2–6.3, 15.1, 16 phase 0 and 18. The [task map](19-prd-task-map.md) still treats full launch simulation/devnet certification as incomplete. Product documents supply requirements; the founder's local-only, free-first, no-deploy instructions control this work.

## What can be reviewed

`/launch-lab` provides editable, browser-only hypothetical scenarios plus read-only summaries of retained server rehearsals. `/admin/10x#launch-curve-lab` adds authenticated save, deterministic replay and evidence download using the existing in-memory operator token. No wallet, signer, RPC, token address or deploy capability is added.

Each scenario represents one hypothetical Solana ATTN edition. The fixed ATTN allocations are **50% native / 20% OG / 20% local $10X / 10% ten-day campaign reserve**. Supply is a positive u64 decimal string divisible by ten, so every allocation is exact without silently choosing a supply-rounding policy. Any liquidity rounding dust stays in its own allocation, never in fees or the campaign reserve. This lab does not distribute campaign rewards or implement $10X issuance.

Token A is ATTN in all three pools. OG/$10X must start at their lower sqrt-price bound: ATTN-only inventories, exactly zero quote deposits. The native pool can explicitly start at its lower bound or at a two-sided interior price; any required hypothetical SOL principal must fit the scenario's explicit quote budget. The native asset uses nine decimals and a 1:1 native-unit reference. All assets are fixed `SIM-ATTN`, `SIM-SOL`, `SIM-OG`, `SIM-10X` aliases. The aligned example deliberately assumes unit prices; its supply, budget and prices are toy arithmetic, not proposed financial settings.

The lab computes exact integer liquidity/deposit amounts, remaining range capacity and up to 24 ordered exact-input net curve probes across the three pools. Successful probes change only the selected pool's principal inventory; range violations, zero output and u64 inventory overflow leave it unchanged. Beyond-range exact input is rejected in full; partial fills are not modeled. The example shows an immediate ATTN sale failing in an empty-quote pool, a quote buy, a reverse sell and an oversized buy failing at the range boundary.

Quote/native values and the ATTN/native reference are explicit hypothetical rational inputs. Asset decimals are included in native-normalized marginal prices. Opening divergence uses exact cross multiplication against the assumed tolerance before formatting. A preset changes the OG reference from one to two native units, visibly flagging a 10,000 bps mismatch. Raw units, price fractions, Q64 sqrt prices and liquidity remain available; screen price approximations are display-only.

## Actual protocol source and scope

This is a BigInt adaptation of **Meteora DAMM v2 SDK 1.5.1 concentrated-liquidity math**, not a generic constant-product replacement. Pinned upstream revision:

- [concentratedLiquidity.ts at `79ebbfe59a225e641a2f37cd03404f26de1b0c8e`](https://github.com/MeteoraAg/damm-v2-sdk/blob/79ebbfe59a225e641a2f37cd03404f26de1b0c8e/src/math/liquidity/concentratedLiquidity.ts)
- [constants at the same revision](https://github.com/MeteoraAg/damm-v2-sdk/blob/79ebbfe59a225e641a2f37cd03404f26de1b0c8e/src/constants.ts)
- Upstream MIT notice retained in `discovery/protocol/meteora-MIT-LICENSE.txt` and cited in the adapted code.

Meteora's stored liquidity is scaled: `A = L × (sqrtUpper − sqrtLower) / (sqrtLower × sqrtUpper)` and `B = L × (sqrtUpper − sqrtLower) / 2^128`. Deposit amounts round up; curve outputs round down. A→B next sqrt price rounds up; B→A increments round down. The model bounds sqrt prices by the pinned SDK constants, liquidity by u128 and token balances/inputs by u64. It does not add another generic Q64 factor to the A formula.

`scripts/generate-launch-math-vectors.mjs` ran the exact published SDK in an ignored temporary directory with install scripts disabled. Its source map's concentrated-liquidity source **matched the pinned upstream file SHA-256** `238f3b84fcc02d34b057d54fadade17a610d9e4c213840cb3dd26e8b763a3941`. The retained fixture records npm integrity, bundle hash, source hash, 32 liquidity/deposit cases and **256 direction/input swap vectors**, including range failures. Runtime tests read that fixture offline. No SDK dependency or signing library was added to the shipped package manifests or lockfile; the lazy lab bundle is 20.81 KB / 7.33 KB gzip.

**This is a net curve kernel, not a complete executable launch simulator.** Probe inputs assume amounts available to the mathematical curve after unmodeled fees. The lab does not calculate gross wallet debit, net wallet receipt, fee modes, dynamic/opening fees, transfer extensions, protocol/referral/creator entitlements, compounding liquidity, slippage protection, gas, bot races, funded route inventory or arbitrage profit. Prices are unverified hypotheses. Pool creation, activation, permanent locks, fee beneficiaries, viable same-chain $10X, mint ordering and devnet transaction receipts remain unverified. Curve inventory is principal, never fee income. Every result explicitly keeps launch, transfers and policy approval false, with missing capability flags and gaps.

D08–D10 and D14–D16 remain open; no supply, reference price, fee policy, range, beneficiary or signing authority was approved. This advances P7's mathematical foundation without completing its economic, protocol or execution acceptance criteria.

## Persistence and access

Migration `0029_launch_curve_lab.sql`, applied only to the existing local discovery database, adds immutable scenario rows and a creation-time index. Update/delete triggers protect retained records. There is no financial or eligibility table migration.

- `GET /api/10x/launches/lab`: five latest recomputed/hash-checked result summaries, excluding operator reason and input/request objects.
- `POST /api/10x/admin/launches/lab`: authenticated strict scenario admission, maximum twenty new records per UTC day.
- `GET /api/10x/admin/launches/lab/:id`: authenticated frozen inputs/result and complete deterministic replay.

UUID retries return identical records at the cap; conflicting reuse returns 409. Scenario and audit insertion commit in a [D1 atomic batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). SHA-256 binds request, normalized inputs, result and record metadata; replay checks timestamps, all hashes and full recomputation. Existing local-runtime, Bearer, origin, method and 32 KB body guards apply. Additional normalized request and retained input/result bounds are 30 KB and 150 KB. No new env variables, provider calls or timers. Public summaries disclose hypothetical budgets/inventories; full assumptions and review reasons stay operator-only. Local retention has no purge yet; remote traffic/storage allowances are not certified.

## Validation and observed result

- **447 discovery tests across 37 files passed**, including 26 launch tests. SDK vector parity, exact allocations at u64 scale, decimal/reference normalization, sub-display divergence thresholds, zero-quote exits, buy/reverse-sell ordering, bounds/overflow, 35 varied sequential scenarios, malformed inputs, idempotency, immutable receipts, atomic audit rollback, concurrent UTC admission, future cutoffs, replay tampering, access/origin/body checks and zero network core replay are covered.
- Discovery typecheck, app typecheck/build and three SPA-navigation tests passed. Home startup remains **233.9 KiB gzip**, within budget. OpenAPI now has **77 paths**, retaining the previous 74 and adding the three lab endpoints.
- The local smoke check saved hypothetical rehearsal `68c57dfc-39fb-446b-96ab-b814aaa45923`. Duplicate save and protected replay were identical; full retrieval without a token returned 401. Its six probe statuses were `range_exhausted`, four `simulated`, `range_exhausted`; OG/$10X began with zero quote and the 10% reserve stayed separate. Active discovery policy and launch/signing/reward capability gates were unchanged. **Zero provider requests** from this check; one local scenario admission used.
- Existing timer/watchdog were healthy. Three election rehearsals and the current plus two legacy backing records replayed; backing outcomes stayed withheld. Security smoke checks denied fifteen private-file requests and passed ten operator admission checks, with zero provider requests.
- Browser review through the existing local tunnel verified the page, opening inventories, price-mismatch preset and browser-only recomputation. No operator token or wallet credential was entered into the browser. No remote deployment or onchain transaction occurred. The ten-eligible-token target remains open; this milestone does not claim discovery coverage gains.

Commands from repository root:

```powershell
pnpm --dir discovery test -- src/launch-lab.test.ts
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app build
pnpm --dir app test -- src/discovery/navigation.test.ts
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-launch-curve-local.ts
pnpm exec tsx scripts/check-discovery-operations.ts
pnpm exec tsx scripts/check-backing-local.ts
node scripts/check-tenx-security-local.mjs
git diff --check
```

Migration command, from `discovery/`, follows [Wrangler's local migration documentation](https://developers.cloudflare.com/d1/wrangler-commands/):

```powershell
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
```

Optional offline-vector regeneration requires the pinned SDK only in ignored `.tmp/meteora-oracle` (the generator documents installation). It is not a runtime or test-suite dependency. Next P7 work: certify a specific fee mode and gross/net swap quotes against the pinned program/SDK; then funded route/race scenarios, lock/fee-owner proofs and devnet receipts, preserving the fixed allocations and all financial release gates.
