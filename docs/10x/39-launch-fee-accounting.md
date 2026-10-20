# Static quote-only fee accounting — local curve lab

21 October 2026. Advances P7 and PRD §§6.2–6.3, 15.1, 16 phase 0 and 18 after the [net curve foundation](38-launch-curve-lab.md). Product documents supply requirements; the founder's local-only, free-first, no-deploy instructions control execution. This is a mathematical subset, not completion of launch simulation or protocol certification.

## Reviewable behavior

`/launch-lab` now defaults to a versioned fee-aware scenario. It retains the net-only example, editable browser calculations, price-mismatch preset, authenticated immutable saving/replay and evidence downloads. Fixed **50/20/20/10** allocation, ATTN-only OG/$10X inception, separate pool inventories and all financial/eligibility gates remain unchanged.

V2 accepts only **static, noncompounding OnlyB (quote-only), fee version 1, exact input**. A buy deducts the trading fee from quote input before curve math; a sell deducts it from quote output before the trader receipt. Each probe shows requested gross input, actual modeled debit, curve input/output, trader receipt, minimum receipt and fee splits. Principal is separate from cumulative LP claiming, protocol and optional referral accruals. These accruals are not observed vault balances, verified claim rights, founder income, treasury receipts or payouts.

The fee rounds up using the SDK's 1e9 denominator. The protocol share rounds down from total fee; referral rounds down from that protocol share. LP claiming receives the remainder of total fee after the pre-referral protocol portion. All calculations use BigInt. Inputs accept the pinned v1 numerator range of 100,000–990,000,000 (1–9,900 bps), with explicit 0–100 protocol/referral percentages. These are hypothetical arithmetic inputs, not approved or deployable pool configurations. The example's 1% fee and 20% protocol/referral shares choose no production economics.

Range, zero-receipt, minimum-receipt and integer-inventory failures leave principal and accrued fees unchanged. The lab also rejects tiny input fully consumed by a rounded input fee, charging zero modeled token debit/fee; this is a conservative probe policy rather than a claim about executed transaction behavior. Native network fees are not modeled. Minimum receipt compares the trader's final receipt, including output fees where applicable; exact equality passes.

## Source and validation boundary

The kernel adapts [feeMath.ts](https://github.com/MeteoraAg/damm-v2-sdk/blob/79ebbfe59a225e641a2f37cd03404f26de1b0c8e/src/math/feeMath.ts) and [swapQuote.ts](https://github.com/MeteoraAg/damm-v2-sdk/blob/79ebbfe59a225e641a2f37cd03404f26de1b0c8e/src/math/swapQuote.ts) from **Meteora DAMM v2 SDK 1.5.1**, commit `79ebbfe59a225e641a2f37cd03404f26de1b0c8e`. The existing upstream MIT notice remains retained. Revision: `meteora-onlyb-static-79ebbfe-v2`.

`scripts/generate-launch-fee-vectors.mjs` invokes the published SDK's full `getSwapResultFromExactInput`, using explicit static fee scheduler bytes and dynamic fees disabled. It generated **240 independent offline quotes** across both directions, initial positions, fee rates and protocol/referral settings: 135 quoted cases and 105 range failures. SDK source-map contents matched the pinned official files:

| File | SHA-256 |
|---|---|
| feeMath.ts | `1252cf633943a77033e0bbf8d7c5bcc4315ad5add15fc37904f0f4ede71ddbdb` |
| swapQuote.ts | `5902ef6c94dca8325a64b13333f6ea2bbc95a1c2ff298b5ac032abd3afa78777` |
| concentratedLiquidity.ts | `238f3b84fcc02d34b057d54fadade17a610d9e4c213840cb3dd26e8b763a3941` |

Fixtures record npm integrity and source hashes. They are generated math results, **not chain receipts**. The SDK stays in ignored `.tmp/meteora-oracle`, installed with lifecycle scripts disabled; it adds no shipped dependency or signer. Tests replay the retained vectors offline. Unsupported fee modes, dynamic/decaying schedules, other fee versions and compounding are rejected, not approximated.

## Compatibility and local evidence

V1 schemas/results remain unchanged. Strict version unions select v1 net-only or v2 fee-aware inputs/results; v1 normalization and hashes receive no new fields or defaults. A retained original v1 record is an offline regression fixture. Both versions reuse the same immutable table, guards and **shared twenty-new-runs-per-UTC-day** quota. No migration, new endpoint, environment variable, timer or provider allowance was introduced. Public summaries still exclude complete input/request objects and review reasons. OpenAPI retains 77 paths and documents both versions.

- **472 discovery tests across 38 files passed**, including 25 new fee tests. These cover SDK parity, gross/net and principal/fee conservation over thirty varied sequences, referrals, minimum receipt boundaries, unsupported assumptions, unchanged failure state, mixed-version replay/tampering, shared atomic admission and API access guards.
- Discovery typecheck and app build passed. Home startup remains **233.9 KiB gzip**, within budget. The lazy curve-lab chunk is 30.61 KB / 9.77 KB gzip.
- Local smoke checks saved v2 rehearsal `839f6eb0-528c-4ff2-9f79-bf9cf2002335`; identical retries and protected deterministic replay passed. The original v1 rehearsal `68c57dfc-39fb-446b-96ab-b814aaa45923` replayed with its original hashes. Unauthorized full retrieval returned 401. All seven v2 probes were accounted for, including the final minimum-receipt rejection with zero charges. No provider requests were made by either smoke check.
- Browser review through the existing local tunnel verified fee accruals and a buy's 1,000 quote debit, 990 curve input, 10 fee and 8 / 1.6 / 0.4 LP/protocol/referral split. No operator token or wallet credential was entered in the browser.
- Existing local timer/watchdog were healthy; three election rehearsals and current plus two legacy backing records replayed. Backing outcomes remained withheld. Security smoke checks denied fifteen private-file requests and passed ten operator admission checks, with zero provider requests.

Validation commands, from repository root:

```powershell
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-launch-fees-local.ts
pnpm exec tsx scripts/check-launch-curve-local.ts
git diff --check
```

The fee smoke check stores/reuses its request UUID in an ignored local file. Optional vector regeneration uses the pinned temporary SDK described in the generator; normal tests need no SDK install or network.

## Remaining P7 work

Dynamic/opening fees, rate limiters, transfer extensions, compounding, gas, transaction simulation, actual program configuration and activation remain unverified. Trader inventory is assumed; funded cross-pool routes, arbitrage, race/slippage scenarios and execution recovery remain next. Same-chain $10X viability, fee beneficiaries, permanent locks and devnet transaction receipts remain open. D08–D10 and D14–D16 are not approved by the lab. No signing, transfers, launch, claims, spending or deployment is enabled. The ten-eligible-token discovery target remains open and this milestone claims no coverage gain.
