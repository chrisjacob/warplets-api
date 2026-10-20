# Verified Pump/PumpSwap trading-fee components

20 October 2026, Australia/Sydney. Local-only extension to cached activity evidence. All current creation, graduation, age, market, holder and wallet gates remain required. No deployment, paid service, new credential, database migration, signature or broadcast.

## Result

Token pages show protocol gross fees, creator-vault payments, LP fees retained in the pool and their sum, separately from network fees. The expandable breakdown identifies the protocol remainder and buyback portion, each swap and event instruction, actual payment paths/recipients, hashes and unresolved gaps. API: the existing cached `/api/10x/activity/solana/:address`, with a new `trading_fees` object. The unused `fees.protocol_trading_fees` / `fees.lp_fees` null placeholders are removed from this local draft contract; the network-fee fields remain. Generated OpenAPI and browser validation match the new shape.

All fee analysis reuses saved finalized wallet transactions and makes **zero new RPC/market requests**. Native Pump fees and WSOL PumpSwap fees are displayed in SOL units, retaining exact integer raw amounts. No USD conversion, lifetime/24-hour extrapolation or organic/bot classification is made. Missing evidence is null, rather than a zero-fee claim. Existing wallet evidence, research cohorts and election records are not rewritten.

## What verification means

`pump-fees-v1` first uses the existing canonical swap verifier, including signer, pool/curve, mint, base/quote flow and temporary-WSOL ownership checks. For each eligible swap it then requires:

1. A supported self-CPI fee event immediately inside that swap's reconstructed call frame. Duplicate/missing events, absent/invalid stack data, wrong programs, wrong authorities and unrelated events cannot substitute for it. The instruction's event authority must be the program's derived `__event_authority` PDA, and the event uses the pinned Anchor event-CPI tag and discriminator.
2. Event user, pool/mint, timestamp, side, accounts and base/quote amounts consistent with that verified execution. Global/config, creator-vault and quote-recipient addresses are derived or matched. Protocol/creator/LP rates come from that event, not current account settings or assumed constant fee tiers.
3. Exact integer fee arithmetic: round each supported charge up at its emitted basis-point rate; compute the buyback split down from protocol gross. Actual protocol remainder, creator-vault and buyback payments must reconcile to unique in-frame transfers with their source, recipient and amount. Native first-use account funding can remain an explicitly unclassified additional transfer and is excluded from known fee components.
4. For PumpSwap, checked WSOL transfers with nine decimals and complete quote-flow reconciliation. Buy pool credits equal gross quote + LP fee; sell user proceeds equal gross quote − LP − protocol gross − creator fee. Additional quote movements or unchecked token transfers prevent an LP-retention/fee claim. LP is retained in reserves rather than transferred to an LP owner; this is not proof of claimable LP revenue.

The sum is **protocol gross + creator-vault fee + LP fee**. Buyback is already included in protocol gross and is never added again. Every swap instruction owns its event and fee evidence; multiple swaps in one transaction can each contribute once. Network fees continue to count the transaction once.

This is **RPC-attested execution reconciliation**. It trusts the retained finalized RPC response and pinned program ABI; it is not an independent Solana validator, signature/state proof or certification of independent economic activity. Fees can be paid by bots, and creator/LP income can accrue to related wallets. Frozen eligibility and self-improvement rules remain unchanged; historical `fees_produced_usd` research values stay unknown because sampled native fees are not complete USD revenue.

## Coverage limits

Supported first slice: native Pump buys with the required fee/creator accounts, and the legacy supported PumpSwap buy/buy-exact-quote/sell account layouts using checked WSOL transfers. Native Pump sells require independent native-balance attribution and remain unverified. Newer AMM layouts without explicit supported recipients, cashback, holder-reward and shareholder routes, truncated/older event layouts, ambiguous/missing transfers and unsupported call metadata stay unknown.

The decoder requires all fields in the pinned layout, caps vectors/strings and preserves integer precision. Appended bytes are labelled uninterpreted; known fee components may still reconcile to execution, but the overall sample remains **partial**. Other self-CPI events and additional native transfers are similarly recorded as gaps, never silently certified. No guessed zero defaults or inferred whole-transaction balance differences fill these gaps.

## Observed cached evidence

The existing saved sample for `DHPxVtGgEyNFWXoN5D2vMTcZXybxxTr8VqLgegNpump` reconciles components for **8/8 swaps**, with **partial overall coverage** due to appended event bytes, another program event and native account funding. Totals:

| Component | SOL / WSOL in SOL units |
|---|---:|
| Protocol gross | 0.808666272 |
| Protocol remainder | 0.404333137 |
| Buyback portion, already in gross | 0.404333135 |
| Creator-vault fees | 0.256131438 |
| LP retained | 0.004461422 |
| Sum of reconciled fee components | **1.069259132** |

Most comes from the creation-time Pump buy: **1.062566990 SOL** in known fee components. An additional 650,240-lamport transfer to the creator vault is excluded as unclassified account funding; its purpose is not independently certified. A separate recorded PumpSwap buy reconciles 111,591 lamports protocol gross (55,796 remainder + 55,795 buyback), 111,591 creator and 446,362 LP, for **669,544 lamports**. A recorded sell independently reconciles **749,583 lamports**. Fixtures reuse previously saved public-chain data; no fresh mainnet transaction claim is made.

## Files and operation

- New: `discovery/src/{trading-fees.ts,trading-fee-model.ts,trading-fees.test.ts}`, `discovery/protocol/fee-schema.json`, `discovery/fixtures/recorded/trading-fees.json`, `scripts/generate-trading-fee-schema.ts`, `app/src/discovery/TradingFees.tsx`.
- Updated: activity API model/derivation/tests, client/reason labels, token detail panel, Vite shared-schema watcher, generated OpenAPI/generator and operating/decision docs.
- The generator checks original IDL bytes against the existing certified SHA-256 hashes before extracting fee layouts at Pump docs revision `639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22`. It supports an offline IDL directory with the same hash checks. Ignored local inspection helpers and downloaded IDLs are not committed.
- No new runtime toggle, dependency or migration. RPC 5,000/day, wallet 800 within that total, quality 1,800 within that total, market 600/day and all cooldowns remain unchanged. Existing local Worker/Vite hot reload loads the changes. No Node supervisor/tunnel restart or deploy is needed. Hosted CPU/production feasibility is not certified by this local replay work.

Commands run:

```powershell
pnpm exec tsx scripts/generate-trading-fee-schema.ts .tmp/fee-idls
pnpm --dir discovery typecheck
pnpm --dir discovery test -- src/trading-fees.test.ts src/activity.test.ts src/service.test.ts
pnpm --dir discovery test -- src/trading-fees.test.ts
pnpm --dir discovery test
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm --dir app typecheck
pnpm --dir app test
pnpm --dir app build
pnpm exec tsx scripts/check-discovery-local.ts
pnpm exec tsx scripts/check-discovery-elections.ts
git diff --check
```

Validation: **159 discovery tests passed**, including ten fee tests covering recorded Pump/AMM buys/sells, account-funding exclusion, buyback double-counting, modified events/amounts/rates/recipients, missing/mis-scoped self-CPI events, unsupported routing, integer precision, multiple swaps per transaction, extra quote-vault debits and unavailable-versus-zero amounts. **773 app tests passed**. Type checks, build and performance budget passed. Saved proof/holder/wallet smoke checks and three current/legacy election replays passed with zero provider requests. Browser verification showed the component totals, partial status, split and per-swap proof controls.

Next: certify native Pump sell balance attribution and the remaining fee-routing/layout variants; then freeze timestamped fee features alongside future research cohorts before proposing any fee-based selection rule. Keep organic activity unverified until independent evidence supports a defined hypothesis.

Primary references: pinned [Pump IDL](https://raw.githubusercontent.com/pump-fun/pump-public-docs/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/idl/pump.json), [PumpSwap IDL](https://raw.githubusercontent.com/pump-fun/pump-public-docs/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/idl/pump_amm.json), [creator-vault semantics](https://raw.githubusercontent.com/pump-fun/pump-public-docs/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/PUMP_SWAP_CREATOR_FEE_README.md), [cashback routing](https://raw.githubusercontent.com/pump-fun/pump-public-docs/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/PUMP_CASHBACK_README.md), [holder rewards](https://raw.githubusercontent.com/pump-fun/pump-public-docs/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/HOLDER_REWARDS_README.md), Anchor's [event tag](https://raw.githubusercontent.com/coral-xyz/anchor/v0.31.1/lang/src/event.rs) and [event dispatch checks](https://raw.githubusercontent.com/coral-xyz/anchor/v0.31.1/lang/syn/src/codegen/program/handlers.rs). Reference fee schedules in old README examples are not used as current rates.
