# Hypothetical funded routes and ordered competition

21 October 2026. Advances PRD §6.3 and P7 after [static quote-only fees](39-launch-fee-accounting.md). The PRD calls for cross-pool routing, early-holder order races, reverse exits and realistic inventory constraints. This milestone supplies a bounded local mathematical model; actual program execution, economics and release decisions remain open. The founder's local-only, free-first, no-deploy instructions control execution.

## Implemented

`/launch-lab` now defaults to a **v3 funded race example**, with a second preset removing the competing buy. Earlier fee-aware, net-only and price-mismatch examples remain available. The browser calculates without provider requests; authenticated operators can save/replay the same versioned scenarios using the existing endpoints.

Each scenario has one to eight synthetic trader aliases with explicit hypothetical SOL, OG and local $10X balances. Every trader starts with **zero ATTN**. No reserve or pool allocation is diverted to fund a trader. ATTN becomes available only through successful buys; later reverse sales require that particular trader's acquired balance. No borrowing, overdrafts, shared trader balances, external conversions or referral credits are added.

Up to twelve ordered actions may be single swaps or two-leg **quote → ATTN → another quote** routes. The quote pools must differ. The second leg spends exactly the net ATTN receipt of the first, including first-leg fee effects. Explicit intermediate/final minimum receipts protect both route legs. Each action checks input funding, curve/range limits, final receipt and u64 wallet capacity before committing. The fee kernel is the unchanged v2 static OnlyB model, backed by the existing independent SDK vectors.

For an accepted action, trader balances, each affected pool's principal and separate LP/protocol/referral accruals advance together. On any failure, the whole action leaves them unchanged, including a first leg that would otherwise have succeeded. The action log records attempted leg statuses separately from committed curve-step indexes. **This rollback is an explicit model assumption, not verified Solana transaction atomicity.** Failed actions apply zero modeled token debit/receipt/trading fee; gas is outside the model.

The example demonstrates:

1. Insufficient trader quote funds prevent any curve quote.
2. A native-funded route into an initially empty OG quote pool rejects its second leg and rolls back the first.
3. An early OG holder buys ATTN, supplying OG principal.
4. A smaller native → ATTN → OG route succeeds using that new capacity and accrues both legs' fees.
5. A large competing native buy moves the curve before the early holder's next buy.
6. The early holder's unchanged **950 ATTN minimum for 1,000 native units** rejects after that competing buy. Removing it permits a **988.042948675 ATTN** receipt. No minimum is silently relaxed.
7. A local $10X buy supplies its quote inventory, followed by a successful native → ATTN → $10X route.

The examples use toy supplies, balances, fee rates, unit prices and sizes; these are not proposed launch settings or claims of viable capitalization. A larger exit can exceed OG capacity even after some OG principal arrives; an explicit regression case preserves that failure. Raw cross-asset inventory changes are displayed without describing them as realized profit or sustainable OG demand.

## Versioning, bounds and persistence

Revision `meteora-funded-routes-79ebbfe-v3` adds strict v3 input/result branches. V1 and v2 schemas, normalization, output fields and hashes remain unchanged. The original retained v2 rehearsal joins v1 as an offline replay fixture. V3 reuses v2's evaluator with only accepted legs retained, and at most 24 legs per scenario; failed provisional calculations do not enter the final pool/fee trace. The fixed 50/20/20/10 allocation, ATTN-only OG/$10X inception, campaign reserve and existing math bounds remain intact.

All versions share the same immutable table, authenticated local guards, request/record bounds and **twenty-new-runs-per-UTC-day** quota. Public summaries continue to exclude full input/request objects and operator review reasons; synthetic trader inventories and action results are part of the public hypothetical result. Alias-only IDs reject wallet addresses/contact strings that do not fit the restricted alias format. Treat all lab inputs as hypothetical review data, not a place for real credentials or personal records. No migration, endpoint, env variable, provider request, dependency, signer or timer was added. OpenAPI remains at 77 paths. Runtime validation also enforces unique/known aliases and distinct route quote pools; JSON Schema does not express those cross-field checks.

## Validation

- **498 discovery tests across 39 files passed**, including 26 new route tests. Cases cover partial-route rollback at either leg/range/minimum, input funding and repeated spend, trader isolation, actual intermediate receipts, reverse sales, output overflow, the competing-buy comparison, malformed scenarios, shared mixed-version admission, retention bounds, access guards, tampering and original v1/v2 hash replay.
- Twenty varied sequences verify conservation of all ATTN (including pool rounding dust and the isolated campaign reserve) and each quote asset across pool principal, trader balances and fee accruals. No fee is treated as trader capital or LP principal.
- Discovery/app typechecks and the app build passed. Home startup remains **233.9 KiB gzip**, within budget. The lazy curve-lab chunk is 39.42 KB / 12.02 KB gzip.
- Local rehearsal `9c219070-2ef3-4dba-b45d-4418db3df38d` saved/retried/replayed identically. Eight actions produced seven committed legs; failed funding/range/minimum actions changed no trader funds. Original v1 and v2 records retained their hashes. Full retrieval without a token returned 401; evidence and launch/signing/reward gates were unchanged. The smoke check made **zero provider requests**.
- Browser review through the existing local tunnel verified the successful no-race receipt and the raced rejection with zero debit and no committed steps. No operator token or wallet credential was entered in the browser.

Commands from repository root:

```powershell
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-launch-routes-local.ts
git diff --check
```

The local smoke script retains/reuses its UUID in ignored `.tmp/launch-routes-local.json`. It checks original records when present, so a fresh local database is also supported. It does not trigger discovery collection or provider refreshes.

## Remaining work

This is two-leg routing under static fee assumptions and fixed hypothetical opening references. External OG/$10X market conversions, changing rate paths, triangular closed-cycle arbitrage, profit after gas, dynamic/opening fees and rate limiters remain unmodeled. Ordered actions show a specific competition sequence, not transaction priority, probabilistic MEV, guaranteed first access or sniper protection. Reordering scenarios does not certify a real router.

Next P7 work: changing external-rate scenarios and explicit closed-cycle valuation; supported dynamic/opening fee behavior; actual route/config/activation proofs; permanent locks and fee claim rights; execution recovery and devnet receipts. Same-chain $10X viability and D08–D10/D14–D16 remain open. No onchain transaction, deployment, spending, rewards or policy activation occurred. The ten-eligible-token discovery target remains open; this work claims no discovery coverage gains.
