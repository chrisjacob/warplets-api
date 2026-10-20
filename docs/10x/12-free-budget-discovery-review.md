# Focused discovery within the free budget

20 October 2026, Australia/Sydney. Local-only implementation; no deployment, paid plan, remote database change, signing or transaction broadcast. The request is at least ten eligible tokens created within the past 24 hours. **That outcome has not yet been achieved.** The existing strict v3 eligibility policy remains active; the target never manufactures qualifiers.

## Diagnosis and observed result

The initial cached audit at 03:41 UTC contained 342 tokens, including 181 with independently verified creation within 24 hours. The capped public list showed 0 eligible, 1 provisional and 99 excluded. Most chain risk snapshots were stale, market caps were usually absent, and newer low-liquidity failures buried stronger provisional tokens. The apparent 100 tokens was a display cap, not the complete stored inventory.

At 04:22:51 UTC, cached coverage contained 346 observed tokens, 183 created within 24 hours and 157 with creation still unknown. Ten met fresh reported market-cap/liquidity floors; seven also passed all non-wallet gates at that instant. The capped 24-hour list showed **0 eligible, 10 provisional, 90 excluded**. Earlier in the focused run ten passed non-wallet gates; holder freshness later reduced that count. These are timestamped observations, not a guaranteed stable shortlist. Missing/partial pre-buy funding history and small verified buyer samples remain blocking. A free RPC 429 stopped further manual collection; the local loops now share persisted backoff and honor Retry-After.

Usage at that observation: **774/5,000 RPC requests, 80/600 market requests**, with wallet 211/800 and focused quality 27/1,800 counted inside the RPC total. Quotas were not reset or increased. These are local request ceilings, not a claim of reserved provider capacity or immunity to provider throttling. Failed attempted requests also consume reservations.

## Changes

- Discover defaults to independently verified creation within 24 hours, offers an explicit all-stored view and surfaces provisional contenders before known failures. The new cached coverage endpoint/panel reports the target, actual eligible count, intermediate coverage and blockers. No policy gate is disabled.
- DEX Screener's free token batch endpoint supplies explicitly reported market cap, liquidity, price and image metadata for up to 30 mints per request. Results must match the exact stored canonical pool, Solana base mint and WSOL quote. FDV stays separate. Ten current contenders receive every batch; up to ten uninspected migrations are screened; remaining slots rotate through discovery/research. Screening alone cannot publish or verify a token.
- Strong screened migrations receive chain-inspection priority. Up to two leads fit within the existing 24-call cycle ceiling. Discovery pacing reserves the unspent quality/wallet allowances within the unchanged global cap.
- A focused five-minute cycle reuses immutable creation/migration proofs, batches finalized mint/pool/vault/curve account reads for ten contenders and rotates supply-reconciled holder inventories. Normal inventory refreshes rotate two at a time; bootstrap can read eight. Old observations keep their original timestamps. Atomic local allowances, pause, leases and shared RPC backoff apply.
- Early wallet history starts before the verified graduation signature; recent pool sampling covers five positions across 24 finalized successful signatures. `wallet-input-v4` / `wallet-signals-v4` can prove temporary WSOL ownership from an ordered initialize/trade/close lifecycle, signed owner/refund authority and zero pre/post state. Contradictory balances, authority changes and incomplete lifecycle evidence fail closed. Legacy v1/v2/v3 replays preserve their prior behavior. A recorded real transaction fixture recovers one previously missed buy; live collection recovered four verified buys for one AODF mint, but its funding coverage remains partial.
- The loopback relay spaces RPC starts by 500 ms, bounds queued delay, shares 429 cooldown and preserves TLS verification. Quality/wallet 429s also persist the shared Worker backoff so other loops wait, including after restart. Last-good evidence is retained and becomes stale normally.
- Newer independently refreshed risk/holder evidence survives concurrent candidate saves. Research baseline timestamps include all retained evidence timestamps. Charts identify their actual source and break on source changes; provider-reported cap is not described as independently audited supply.

## Files and configuration

Backend modules: `priority.ts`, `coverage*.ts`, `dex-market*.ts`, `lead-queue*.ts`, `quality-cycle*.ts`, `temporary-wsol*.ts`; changes in ingestion, market/wallet cycles, RPC, models, storage and Worker routes. New local migrations: `0010_quality_refresh.sql`, `0011_lead_markets.sql` (applied locally). Recorded fixture: `fixtures/recorded/temporary-wsol-trade.json`. Tests and generated environment/OpenAPI contracts accompany these changes.

UI files: `app/src/discovery/{DiscoveryPage.tsx,TokenMarket.tsx,client.ts}` and the shared-contract Vite watcher. Runtime files: `scripts/{dev-discovery.mjs,discovery-operator.mjs,discovery-relay.mjs,discovery-relay.test.mjs,generate-discovery-openapi.ts}`. Operating docs: this review, kickoff index and `discovery/README.md`. Ignored local helpers, database, tokens and logs are not committed.

New settings: `TENX_MARKET_PROVIDER=dexscreener` (GeckoTerminal remains selectable), `TENX_QUALITY_ENABLED=true`, `TENX_QUALITY_RPC_DAILY_LIMIT=1800`. Global RPC 5,000/day, market 600/day and wallet 800/day remain unchanged. All reservations are local UTC-day ceilings. No new credential or installed dependency is required. The existing Windows supervisor and preview tunnel remain in use; only its verified discovery child launcher was restarted to load the relay/timer changes. `node scripts/discovery-operator.mjs quality-refresh` invokes the same bounded authenticated local path.

## Validation

Commands run (build is local output only):

```powershell
pnpm --dir discovery types
pnpm --dir discovery typecheck
pnpm --dir discovery test
pnpm --dir discovery test -- src/service.test.ts
node --test scripts/discovery-relay.test.mjs
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm --dir app test
pnpm --dir app build
pnpm exec tsx scripts/check-discovery-local.ts
pnpm exec tsx scripts/check-discovery-elections.ts
git diff --check
```

Discovery suite: 143 tests passed, followed by market-screen isolation and provider Retry-After regressions passing in the 32-test service suite (145 total tests now). Relay: two tests passed, including concurrent request spacing and shared 429 behavior. App: 773 tests passed; build and performance budget passed. Type checks passed. Local smoke check replayed four paired creation/migration proofs, four account snapshots, three holder inventories and three wallet analyses; public admin access returned 401, authenticated access 200. Three saved elections replayed as verified, including a legacy snapshot; no provider reads were made by either smoke/replay script. Browser verification confirmed the 24-hour default, visible provisional contenders and truthful zero eligible target.

## Limits and next step

Ten fully eligible tokens cannot be promised from this bounded free source and strict evidence policy. Current wallet gates require at least three verified buyers, the early creation window, signed creation identity, dated pre-buy funding coverage and fresh exposure evidence. The 800-call wallet allowance plus one-hour freshness can leave gaps even when market/holder checks pass. Provider-ended/unsupported history is not proof of clean funding, and waiting does not itself resolve it. The question of whether such gaps should remain discovery-blocking or become separately labelled research checks was raised with the user; no answer was received, so the strict policy was preserved.

Next: deepen resumable cached wallet coverage and measure RPC cost per qualifying token before changing freshness or selection policy. Continue to expose incomplete early/funding samples. Additional unresolved limits include non-exhaustive migration scans, 500-candidate read/rehearsal bounds, more than 5,000 token accounts per inventory, unsupported layouts/transaction versions, hosted CPU/storage feasibility, production market-data rights and lack of independent circulating-supply validation. No safety, organic ownership, common control or bundle-membership guarantee is implied.

Primary references checked: [DEX Screener API reference](https://docs.dexscreener.com/api/reference), [API terms](https://docs.dexscreener.com/api/api-terms-and-conditions), [Solana SyncNative](https://solana.com/docs/tokens/basics/sync-native), [CloseAccount](https://solana.com/docs/tokens/basics/close-account), [SPL Token instruction definitions](https://raw.githubusercontent.com/solana-program/token/main/interface/src/instruction.rs), [Solana clusters](https://solana.com/docs/references/clusters). Commercial production rights remain an open decision; no terms acceptance or purchase was performed.
