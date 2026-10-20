# Funded linear opening-fee rehearsals

21 October 2026. Advances PRD §§6.3–6.4, 17.3 and 18 / P7. After [independent closed-cycle probes](42-closed-cycle-probes.md), the lab now models timestamp-based high-to-low fees on funded swaps and two-leg routes. The user authorizes local development, free services, unchanged evidence gates and commit/push; no deployment, financial execution or production economics are authorized.

## Implemented

`/launch-lab` now defaults to a **v5 timed opening-fee example**. V1–v4 presets, schemas and immutable hashes remain unchanged. Each scenario has one assumed timestamp activation point, up to eight synthetic traders and twelve chronologically ordered actions. Equal timestamps retain their explicit array order. Raw timestamps are unsigned u64 Unix-second assumptions, distinct from the record's frozen `as_of` observation time.

Each pool has its own linear schedule: opening/cliff fee numerator, number of periods, positive period duration and positive reduction factor. The implementation follows the pinned Meteora DAMM v2 SDK 1.5.1 at `79ebbfe59a225e641a2f37cd03404f26de1b0c8e`:

```
period = min(floor((action_point - activation_point) / period_frequency), number_of_periods)
fee_numerator = cliff_fee_numerator - period * reduction_factor
fee_denominator = 1,000,000,000
```

Fee version 1's modeled range remains 1–9,900 basis points, including the terminal fee. Period count is bounded to 1–65,535; schedule end must fit u64. Period/reduction/frequency zero combinations, a negative or sub-minimum terminal fee, descending action times, unknown/duplicate traders and same-pool routes are rejected. This is a deliberately bounded nonstatic linear subset, with the volatility-based component disabled, OnlyB collection and no compounding.

**Fee calculation is separate from trading permission.** The SDK time-fee calculator returns the terminal fee before activation. V5 reproduces that arithmetic for oracle checks, but its action evaluator rejects every before-start action with `not_active`, without quoting or changing balances/fees. This model guard is not verified access control or an assertion about every real program entry path.

At each permitted action, the engine evaluates each leg against current principal using that pool's fee at the supplied timestamp. Earlier fills and accruals retain their original fee; crossing a later period boundary never reprices the trace. Both legs of a route use the same point, but may have different per-pool rates. The second leg spends exactly the first leg's net ATTN receipt. Only wholly successful actions commit principal, balances, fees and trace indexes together. Failed funding, range, minimum-output or wallet-capacity checks discard the entire provisional action, including a successful first leg's fees. No gas is charged or modeled.

The original exact 50/20/20/10 supply allocation, zero initial trader ATTN, ATTN-only OG/$10X inception, u64 inventory bounds and separate principal/LP/protocol/referral accounting remain enforced. The frozen static fee and curve evaluators are reused one leg at a time, with a copied current-principal seed and separately accumulated prior fees; their historical behavior is unchanged.

The UI discloses opening/terminal rates and period duration, each action's offset from start, attempted per-pool rates and guard result. Existing funded-action and fee detail views retain exact receipts and inventory changes. These hypothetical settings are not suggested production parameters or a promise of sniper protection.

## Independent SDK evidence

The offline generator `scripts/generate-launch-opening-vectors.mjs` uses the already installed, ignored oracle SDK; it adds no dependency to the application and makes no chain/provider calls. Its retained fixture pins npm integrity, source commit and six source hashes. SDK decoding independently checks aligned scheduler fields; SDK fee validation accepts each oracle schedule and allows its mode for new-pool parameter validation.

**136 vectors** cover preactivation, activation, just-before/at period boundaries, terminal/late points, maximum u16 periods, near-u64 duration/timestamps, both swap directions and several trade sizes. There are 102 SDK quotes and 34 range failures. Regressions compare effective fee, net input, net receipt, next sqrt price and LP/protocol/referral split. A fee-consuming single-unit input is classified explicitly rather than presented as a trade.

Primary pinned sources:

- [Time scheduler and before-start arithmetic](https://github.com/MeteoraAg/damm-v2-sdk/blob/79ebbfe59a225e641a2f37cd03404f26de1b0c8e/src/math/poolFees/baseFee/feeTimeScheduler.ts).
- [Linear fee calculation](https://github.com/MeteoraAg/damm-v2-sdk/blob/79ebbfe59a225e641a2f37cd03404f26de1b0c8e/src/math/poolFees/baseFee/feeScheduler.ts).
- [Fee limits and new-pool mode validation](https://github.com/MeteoraAg/damm-v2-sdk/blob/79ebbfe59a225e641a2f37cd03404f26de1b0c8e/src/helpers/validation.ts).

The pinned SDK rejects the deprecated **RateLimiter** mode for new pools/configs. Do not treat legacy quote support as permission or compatibility to build a new launch with that mode. Exponential, market-cap and volatility-dependent schedules are separate, unimplemented scopes.

## Validation and local evidence

- **565 discovery tests across 42 files passed**, including 28 new timed cases. Tests cover SDK parity, separate activation rejection, exact boundaries, fixed earlier fees, static-engine equivalence at one rate, per-pool route fees, first/second-leg and wallet-bound rollback, same-point ordering, funded reverse sales and conservation across twelve varied schedules.
- Maximum eight traders / twelve successful two-leg actions fit the existing 30 KB normalized request and 150 KB input-plus-result retention bounds. All versions continue sharing twenty new records per UTC day, authenticated local guards and immutable replay.
- Local record **`c6461d73-3c2f-4608-818e-9b7fcd9d99ee`** saved, retried and replayed identically. All four earlier server records retained their original hashes. V4's original cycle record is now an offline fixture alongside v1–v3. Public summaries omit input JSON/review reasons; unauthenticated full retrieval returns 401. Active policy and disabled launch/signing/reward capabilities were verified unchanged.
- The toy schedule drops from 50% to 1% in four 60-second reductions. A buy one second before start is rejected; a buy at activation fails its unchanged minimum receipt; a relaxed-minimum diagnostic at +59 seconds uses 50%; +60 uses 37.75%; +240 uses 1%. Later OG funding and a two-leg route succeed at the terminal fee. All numbers are hypothetical demonstration inputs.
- Discovery/app typechecks, app build and startup budget passed. Home startup remains **233.9 KiB gzip**. The lazy lab chunk is 60.57 KB / 16.82 KB gzip. Browser-only recomputation and the visible schedule/action outcomes were checked through the existing local tunnel.
- Local security smoke checks passed: fifteen private requests denied, ten admin origin/body checks, public routes available and signed action sessions required. Verification, oracle generation and the local rehearsal made zero source/provider requests.
- OpenAPI still has 77 paths. No endpoint, migration, runtime dependency, source provider, timer, signer, spending permission or discovery gate changed.

Commands from the repository root:

```powershell
node scripts/generate-launch-opening-vectors.mjs
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-launch-timed-local.ts
node scripts/check-tenx-security-local.mjs
git diff --check
```

The smoke script reuses the request/UUID in ignored `.tmp/launch-timed-local.json`; repeated checks do not consume another lab admission slot. The optional oracle generator requires the existing pinned SDK installation under `.tmp/meteora-oracle`.

## Remaining work

This verifies a mathematical linear-time subset, not deployable pool configuration, actual activation, clock/slot behavior, transaction atomicity, fee ownership, permanent locks or devnet receipts. Real external routes, sequential arbitrage with changing external markets, volatility/exponential/market-cap fee state, supported additional anti-sniper methods and execution recovery remain open. V4 independent cycles and V5 timed funded actions are separate experiments; the lab does not claim they have been combined into one executable route.

D08–D10/D14–D16 remain unapproved. No launch, signing, spending, reward entitlement, treasury action, deployment or evidence-gate relaxation occurred. This milestone makes no discovery coverage gain; reaching ten eligible tokens remains unfinished.
