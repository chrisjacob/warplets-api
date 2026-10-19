# Bundle signals and creation/buyer wallet analysis

20 October 2026, Australia/Sydney. Local runtime and local D1 only; free public Solana RPC. No deployment, remote migration, paid plan, signing or broadcast. The existing scheduled supervisor now runs a fourth, independent wallet-analysis loop. Review [the recorded token](https://app-local.10x.meme/token/solana/3mmewUcttCpSJwVx9BcquZNmwEfJs4nZpKfTDXdipump#wallet-analysis), [source status](https://app-local.10x.meme/status), and [daily research](https://app-local.10x.meme/research).

## Evidence and interpretation

The decoder recognizes pinned Pump and PumpSwap buy/sell instructions, canonical curve/pool and vault addresses, successful finalized legacy/v0 transactions, real transaction signers, token-account owners and actual SPL transfer CPIs in the correct instruction subtree. A transfer, a log, a net balance change, a declared creator label or another CPI's transfer cannot alone establish a buy. Loaded addresses are resolved; duplicate or inconsistent account indexes fail closed. Pump SOL-paired v2/v3 instructions use seed-constrained WSOL quote placeholders but native SOL transfers. PumpSwap requires actual quote-token flows. Temporarily opened/closed accounts without retained ownership evidence remain uncertified.

The creation-instruction user and the creator declared in instruction data are shown separately. Only roles actually signed in the creation transaction support creation-wallet funding/sales checks. These are wallet roles, not verified human identities or guarantees about a developer. Original creation/graduation normalization and hashes are preserved by using a separate richer transaction parser.

The analysis records:

- Verified buys/sells, raw token amounts, signer, fee payer, instruction path, finalized slot and transaction hash.
- Distinct buyers sharing an early slot, a transaction or a fee payer. Early means creation slot through creation +20 slots.
- Direct, top-level, signed System transfers to sampled wallets. A funding relationship requires a preceding slot, or an earlier instruction in the same transaction, within one hour before a sampled buy. Distinct transactions in one slot have no inferred order. Rent/refunds and arbitrary CPI transfers are not funding evidence.
- Buyers with an observed common funder or signed creation-wallet funder, same-transaction buy/sell round trips, and sampled creation-wallet gross sales.
- Current supply shares only when raw holder inventory replays exactly, matches mint/pool/program and is fully reconciled, layout-certified and at most 30 minutes old. Funding connections are observed lower bounds. Gross sales/current supply may exceed 100% with repeated trading; they do not measure the initial allocation dumped.
- Earlier severe-loss associations across distinct other tokens from already-measured local daily reports, with report hashes. Duplicate reports for one token do not multiply the count. Unsigned labels alone cannot create a loss association.

**Actual bundle membership is always unknown.** A same-slot group, shared sponsor, exchange funding or fee payer is not proof of a Jito bundle, Sybil ownership, manipulation or fraud. “No signal in sample” is not “safe.” Lifetime wallet age/history, cross-token P&L, actual fees produced, beneficial ownership and comprehensive launch participation remain unknown. Oldest sampled signature reference is not wallet age. Unsupported versions, missing metadata, unexamined histories, paging limits and stale holdings appear as explicit gaps.

The committed real fixture for `3mmew…ipump` was captured at `2026-10-19T23:19:50.488Z`. Offline replay verifies **seven buys by seven wallets**, all in the early same-slot sample, with up to **three buyers in one transaction**. It does not prove a bundle. The sample also retains transactions that cannot be certified and stale holder/funding gaps. Fixture provenance, raw normalized input, expected output and SHA-256 hashes are retained; it is a historical sample, not a current recommendation.

## Budgets, automation and controls

`TENX_WALLET_ANALYSIS_ENABLED=true` and `TENX_WALLET_RPC_DAILY_LIMIT=800` are local configuration toggles. The 800-call allowance is a **subset** of the existing 5,000-call global RPC hard cap, not an extra allowance or paid subscription. Market remains 600 requests/day. Atomic daily counters, a six-minute lease, provider backoff and a global pause survive restarts. Targeted manual refresh may bypass normal pacing, but cannot bypass source error backoff, pause, quotas or a live lease.

Each tick handles one stored live token, rotates attempts and uses at most 18 RPC requests, two 1,000-signature curve pages, 12 retained rich transactions and three 20-signature wallet histories. Cached finalized transactions are hash checked and reused. There is no endpoint that triggers collection for arbitrary public wallet input. Public wallet/evidence routes only read local D1; refresh is authenticated and audited. A wallet endpoint returns at most 20 locally observed token profiles, not a complete wallet history. Error paths retain the last good analysis, release leases and defer the attempted token to avoid starving the queue.

Source requests are spaced across the remaining UTC budget, with a five-minute minimum and two-hour maximum interval. This free-service sample cannot give continuous whole-market surveillance or fresh wallet coverage for all 100 tokens. The workstation must remain awake. The current-user `10X-Discovery-Local` task and supervisor own this service; the owned child was restarted to load the wallet timer while preserving local state and pause, then refresh was resumed.

```powershell
node scripts/discovery-operator.mjs status
node scripts/discovery-operator.mjs wallet-refresh
node scripts/discovery-operator.mjs wallet-refresh 3mmewUcttCpSJwVx9BcquZNmwEfJs4nZpKfTDXdipump
node scripts/discovery-operator.mjs pause
node scripts/discovery-operator.mjs resume
```

## Local policy and daily improvement

`discovery-local-v3` is a **proposed local policy**, not founder-approved production eligibility. It retains the previous holder/authority/age/market rules and requires a wallet sample no older than one hour, at least three verified buyers, signed creation roles, reached creation window, no material missing/certification/funding-sample gaps and known holder-derived exposure. Observed creation-funded buyer holdings above 20% or sampled gross creation-wallet sales above 5% of current supply exclude a token. Missing evidence stays provisional. Same-slot/shared-payer heuristics alone do not exclude. These local thresholds are configurable in the policy schema and remain open under D06. Launch eligibility remains false.

First discovery and first recommendation snapshots stay immutable. Because wallet collection arrives later, migration `0006_wallet_research.sql` adds a separate first usable wallet-sample baseline for each token/day. Daily reports prefer the recommendation, otherwise that wallet baseline, otherwise first discovery, and expose the cohort kind. The 24-hour measurement starts at that baseline; later knowledge is never paired with an earlier price. Wallet counts, shared funders, creation-funded supply, sampled sales, verified roles and hashes are frozen there. Unavailable/stale wallet samples cannot establish this baseline. Old cohorts parse with unknown wallet fields. Daily review can test the new numeric thresholds using the existing minimum 40 measured outcomes, adequate train/validation coverage and chronological holdout. Proposals stay inactive; severe-loss associations never automatically ban wallets. A new monitoring sample is not claimed as historical performance validation.

## Files and validation

- `discovery/src/wallet-{model,rpc,trades,analysis,cycle}.ts`: contracts, rich read-only parser, canonical trades, replayable signals, bounded collector and quotas.
- `discovery/protocol/trade-schema.json`: 15 instruction layouts extracted from official IDLs pinned to revision `639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22`; IDL hashes match the existing protocol pin.
- Migration `0005_wallet_analysis.sql`: local control/usage, attempts, immutable transaction/evidence storage and cached wallet profiles. Applied locally only.
- `model.ts`, `store.ts`, `ingest.ts`, `research*.ts`, `worker.ts`, generated types/config/OpenAPI: conservative gates, independent snapshot merge, frozen research features and cached APIs.
- `app/src/discovery/WalletAnalysis.tsx`, `DiscoveryPage.tsx`, `client.ts`, `app/vite.config.ts`: wallet evidence, profiles, signals/gaps, operations status/admin and shared-contract reloads.
- Timer/operator/OpenAPI/smoke scripts, offline adversarial tests and `fixtures/recorded/wallet-evidence.json`.

Exact validation commands (no deploy commands):

```powershell
pnpm --dir discovery types
pnpm --dir discovery typecheck
pnpm --dir discovery test
node --test scripts/discovery-relay.test.mjs
pnpm --dir app typecheck
pnpm --dir app test
pnpm --dir app build
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-discovery-local.ts
git diff --check
```

Tests cover real offline replay, signer/owner/mint/vault checks, loaded addresses, CPI siblings, failed/transfers-only transactions, funding order, distinct-token loss counts, fresh/stale holder shares, round trips, frozen feature timing, complete collection/cache persistence, atomic nested quotas, provider backoff, leases, cached reads and preserving newer independent snapshots against older chain writes. App build includes the performance budget. Validation results and commit are reported with the completion message.

Validation checkpoint: **85 discovery tests**, **773 app tests across 128 files**, relay allowlist test, both TypeScript checks, app build/performance budget and generated contract passed. The cached local smoke check replayed three paired origin/migration proofs, three account snapshots, three holder snapshots and one wallet snapshot, with zero external requests from the check itself. It observed 100 contenders, zero eligible tokens, 96 token images and one frozen usable wallet baseline. Counts are observations, not fixed acceptance targets. No token launch was enabled.

Live validation also exposed a zero-byte instruction in an otherwise valid transaction that stalled the previous chain decoder. Empty instruction data now resolves to zero bytes without becoming Pump evidence; malformed nonempty data still fails. A regression covers both cases. Source errors expose only bounded error codes/schema paths, without dumping response values or credentials.

After the persisted backoff expired, a live bounded retry succeeded with 16 read-only RPC requests and one processed token. Wallet collection was resumed, its latest sample succeeded without a wallet source error, and the automatic timer was observed honoring its next-refresh time. Both new local migrations and the separate first-wallet baseline were verified directly in the local database.

Next: accumulate measured outcomes and improve pre-buy funding history coverage within the existing cap; compare missingness and sample breadth before changing thresholds. Certify temporary WSOL ownership paths separately. No paid indexer or production eligibility change is implied.

## Primary sources checked

- [Pinned Pump buy v2 account semantics](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/BUY.md), including native-SOL quote placeholders.
- [Pinned PumpSwap v2 trade accounts](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/instructions/PUMP_SWAP_TRADE_V2.md), requiring user base/quote accounts.
- [Solana transaction JSON](https://solana.com/docs/rpc/json-structures) and [bounded signature paging](https://solana.com/docs/rpc/http/getsignaturesforaddress): headers, loaded addresses, inner instructions, token balances and pagination.
- [Jito bundle definition and status APIs](https://docs.jito.wtf/lowlatencytxnsend/): bundle status takes known bundle IDs. Inference: ordinary sampled Solana RPC records do not establish complete bundle membership; this implementation makes no Jito calls and exposes that gap.
