# Holder analysis, charts and daily research

20 October 2026, Australia/Sydney. The previous discovery commit `0f0dc3c` was pushed first, as requested. These additions continue on `codex/10x-thesis-foundation`. Application runtime and data remain local. No deployment, remote database migration, paid subscription, signing or financial transaction was performed.

## Review

- [Contenders with token images](https://app-local.10x.meme/discover).
- [Live strict holder-evidence example](https://app-local.10x.meme/token/solana/3mmewUcttCpSJwVx9BcquZNmwEfJs4nZpKfTDXdipump).
- [Daily review and collection progress](https://app-local.10x.meme/research).
- [Automation and provider status](https://app-local.10x.meme/status).
- [Operations guide](../../discovery/README.md) and [generated API contract](../../discovery/openapi.json).

Token images are provider metadata, not an endorsement or identity proof. The image URL must match the requested mint's included token record and pass a public HTTPS host allowlist. The browser sends no referrer; unavailable/failed images fall back to initials. No arbitrary token metadata URL is fetched by the backend.

Token details have price and market-cap charts, 1h/24h/7d ranges, pointer inspection, a keyboard slider and accessible tables. Values come from saved GeckoTerminal observations with actual fetch timestamps. Missing market cap stays missing; FDV never fills it. Lines break on nulls and gaps over 30 minutes. No historical series is invented. Existing stored snapshots were backfilled once with their original fetch dates; new samples accumulate automatically.

## Local automation

The current-user Windows task **10X-Discovery-Local** is installed and was verified with a successful result (`LastTaskResult=0`). It starts a hidden supervisor at login and repeats a start/check every five minutes. A process lock prevents duplicate supervisors; health checks restart only the owned discovery child. The task requires an interactive logged-in user, no stored password and no elevated run level. It does not wake a sleeping computer. Source work resumes when the workstation is awake; it cannot run while the machine is off.

The service uses the existing isolated `discovery/.wrangler/local` database, API port 8794 and restricted relay port 8795. The app/tunnel remains on the existing local setup; production configuration is unchanged. The scheduled task supervises discovery, not unrelated applications or the entire preview stack.

The 60-second timer checks:

1. Heartbeat and hourly catch-up of daily research, with no provider calls.
2. One free market request every three minutes, covering up to 30 pools with token images. It rotates attempted pools, retains old values when a pool is omitted, and tracks recent research cohorts beyond shortlist membership so outcome endpoints can still be measured.
3. Chain verification paced across the remaining UTC RPC budget, with a five-minute minimum spacing. One candidate is investigated per chain cycle. Quotas, pause, leases and provider backoff survive restarts.

The prior 3,000-call RPC cap was reached overnight. It correctly stopped calls instead of purchasing service. This local update uses a **5,000-call hard daily cap on the same free public RPC**, and paces work across the day. Market requests remain capped at **600/day**. These are local request budgets, not paid plans. Neither full chain coverage nor 60-second refresh for all 100 assets is claimed.

The first supervised market cycle requested and updated 30 pools successfully. A later local smoke check observed 97 provider images among 100 displayed tokens, two replayable holder snapshots, price history and one daily report. Counts change as sampling continues. Public reads and the smoke check make zero external provider requests.

A controlled failure-recovery check stopped only the supervisor-owned discovery child while source work was paused. The watchdog automatically started a new child, retained pause and all local data, and the subsequent smoke check replayed three saved holder snapshots successfully. Source refresh was explicitly resumed afterward. This verifies recovery behavior beyond simply registering the task.

```powershell
# Inspect/start/reinstall the reversible current-user task
Get-ScheduledTaskInfo -TaskName 10X-Discovery-Local
Start-ScheduledTask -TaskName 10X-Discovery-Local
./scripts/install-discovery-local-task.ps1

# Local operation, without printing the ignored operator key
node scripts/discovery-operator.mjs status
node scripts/discovery-operator.mjs pause
node scripts/discovery-operator.mjs resume
node scripts/discovery-operator.mjs refresh
node scripts/discovery-operator.mjs market-refresh
node scripts/discovery-operator.mjs review
```

Supervisor output is ignored under `.tmp/discovery-supervisor.log`; its lock contains only a process ID. Disabling the task stops future starts; an already-running supervisor must be stopped separately, after verifying its PID/command. Do not terminate unrelated Node/Cloudflare processes. One confirmed orphan lease from development hot reload was released conditionally only when it had no corresponding job. Job setup/pacing now sits inside the failure handler so setup errors release leases normally.

## Concentration and eligibility

The verifier uses finalized `getProgramAccounts` with a mint filter and a 166-byte data slice, bounded to 5,000 accounts/3 MB. It retains the RPC's original account size and rejects multisig/incorrect-size accounts, preventing sliced data from impersonating an ordinary holder. It also checks program owner, non-executable status, token-account layout/type, mint and account state, duplicate addresses and canonical vault identity. A separately finalized mint read at or after the inventory slot must be within 150 slots. Balances are summed as integers and reconciled to mint supply. Mintable, incomplete, unsupported or supply-mismatched results cannot pass. Only certified mint extensions from the existing chain verifier are accepted.

Positive balances are aggregated by token-account **owner** before calculating concentration. Only the exact canonical PumpSwap base vault is excluded from ranked holders. Unknown custody, another pool, an off-curve owner or a wallet nickname is never automatically exempted. All percentages use total minted supply; the pool's share is shown separately. Rounding is conservative at threshold boundaries.

Versioned **proposed local policy `discovery-local-v2`** starts with:

| Holder metric | Local starting rule |
|---|---|
| Positive-balance non-vault owners | At least 100 |
| Largest owner / total supply | At most 10% |
| Top ten owners / total supply | At most 35% |
| Pump creation-instruction user / supply | At most 5%; unknown cannot pass |
| Holder evidence age | At most 30 minutes |

Existing creation/graduation, authority, liquidity, real market-cap, age and freshness checks remain. These are engineering parameters for local review, not an approved public eligibility policy. Candidate eligibility and launch eligibility remain separate; launch capability is always false.

Strict `owners-v2` evidence includes certified original account size and full base account layout/type checks. Earlier prefix-only local records remain hash-replayable but cannot pass the holder gate. Raw inventory, mint state, slot, observed time and hash are saved behind the public cached holder-evidence endpoint.

The recorded real fixture for mint `3mmewUcttCpSJwVx9BcquZNmwEfJs4nZpKfTDXdipump` reconciles at slot **459001761**, with **29** non-vault owners, largest share **3.358193%** and top-ten share **6.358192%**. It fails the minimum-holder rule despite a low largest-owner share. The fixture is a historical RPC-attested account snapshot, not a current recommendation or proof of safety. Its payload hash and provenance are committed for offline replay.

## Daily improvement loop

First observation and first eligible recommendation are retained separately for each Sydney calendar day, along with frozen candidate fields, policy, timestamps and input hashes. A token observed while provisional is not retroactively described as recommended. If it later qualifies, its first qualifying snapshot is stored independently. Current collection counts are visible immediately.

Hourly maintenance reviews the previous three Sydney days. Next-morning windows that have not reached 24 hours remain pending. A valid endpoint must be within 30 minutes before or two hours after the 24-hour target; missing/stale baselines or absent endpoints remain insufficient. Reports retain hash-addressed revisions rather than overwriting past inputs. Sampled drawdown is labeled as sampled, not continuous coverage. Severe price/liquidity loss is an investigation signal, not a fraud finding.

The initial research engine tests holder count, top-one/top-ten owner concentration and liquidity thresholds. It requires at least 40 measured outcomes, adequate feature coverage (at least 25 training/12 validation samples), chronological 70/30 splitting, minimum flagged samples, at least 60% holdout loss precision and at least ten percentage points of improvement over the holdout baseline. Non-loss exclusions are reported. All proposals remain inactive and require review; small/biased datasets do not silently change selection rules.

Wallet research tracks creation-instruction-user and large-owner associations with evidence hashes. Repeated severe-loss associations require at least two **distinct tokens**, deduplicated across retained 30-day reports. Repeated observations of one token do not inflate that count. Associations are review leads, not proof that a wallet is malicious, a verified common controller, a buyer-wallet classifier, or an automatic ban.

Fees actually produced, bundle risk, buyer-wallet histories, beneficial-owner clusters and LP lock status remain unknown, explicitly represented in frozen features and reports. Volume is not substituted for actual fee revenue. There are currently no completed 24-hour outcomes for this new loop; no historical selections, scam labels or performance wins have been fabricated.

## Files and validation

- `discovery/src/holders.ts`, `holder-model.ts`, `rpc.ts`, `pump.ts`, `model.ts`: owner evidence, canonical identity and policy gates.
- `market.ts`, `market-cycle.ts`, `store.ts`, migration `0004_research_history.sql`: batched images/prices, retained history, cohorts, selections, reports and wallet signals.
- `research.ts`, `research-model.ts`, `worker.ts`, `openapi.json`: daily measurement, holdout proposals, public read contracts and authenticated maintenance.
- `app/src/discovery/TokenMarket.tsx`, `DiscoveryPage.tsx`, `client.ts`, `discovery.css`, `main.tsx`: images, interactive charts, holder evidence and daily research screens.
- `app/vite.config.ts`: development watcher/reload for shared discovery contracts, keeping browser validation in sync while both local processes are being edited.
- `scripts/dev-discovery.mjs`, `supervise-discovery.mjs`, `start-discovery-local.ps1`, `install-discovery-local-task.ps1`, relay/operator/check/generator scripts: local automation and operations.
- Tests and `discovery/fixtures/recorded/holder-*.json`: offline synthetic, adversarial and actual finalized evidence replay.

```powershell
pnpm --dir discovery types
pnpm --dir discovery typecheck
pnpm --dir discovery test
node --test scripts/discovery-relay.test.mjs
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm --dir app typecheck
pnpm --dir app test
pnpm --dir app build
pnpm exec tsx scripts/check-discovery-local.ts
git diff --check
```

Validation covers real/synthetic supply reconciliation, owner aggregation, partial/duplicate/mismatched/oversupply/stale evidence, canonical vault exemptions, strict account types/sizes and multisig rejection, concentration boundaries, policy pass/fail, frozen observations versus recommendations, outcome maturity/missing data, holdout rejection, wallet deduplication, hostile image URLs, batch leases/history, API validation and paced source work. Existing app regression: **773 passed across 128 files**. Discovery: **60 passed across seven files**. Restricted relay: **one passed**. Type checks, build and performance checks passed. No dependency was added. Local migrations ran only against the discovery store.

The running-service check replays saved creation/graduation, account and holder hashes; validates history/review contracts; confirms unauthorized admin 401/authenticated jobs 200 and no financial capabilities. Browser review covers contender images, price chart/missing cap state, holder evidence and daily-review collection. Screenshots are local and ignored under `.tmp/`.

Next: collect genuine 24-hour outcomes, then inspect source yield and missing endpoints before interpreting any filter proposal. Extend wallet funding/bundle and actual fee/organic-trade evidence with replayable sources; do not infer those signals from names or raw volume. Broader archival/version coverage, production data rights and all financial milestones remain separate work.

Primary references checked during implementation: [Solana filtered account inventory](https://solana.com/docs/rpc/http/getprogramaccounts), [largest token accounts (not beneficial-owner counts)](https://solana.com/docs/rpc/http/gettokenlargestaccounts), [SPL Token account layout](https://github.com/solana-program/token/blob/main/interface/src/state.rs), [Token-2022 account-type layout](https://github.com/solana-program/token-2022/blob/main/interface/src/extension/mod.rs), [GeckoTerminal public API](https://api.geckoterminal.com/docs/index.html), [CoinGecko/GeckoTerminal pool fields and null-cap distinction](https://docs.coingecko.com/reference/pool-address), [multiple-pool contract](https://docs.coingecko.com/reference/pools-addresses). Actual free public batch/inventory availability was also tested with read-only requests; no assumption about paid endpoints was used as proof of free access.
