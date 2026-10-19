# Local Solana discovery

Implemented 20 October 2026, extended with holder analysis, images, charts and daily research. **Local runtime only. No deployment, signer, transaction broadcast, token mint, live voting, reward payment or treasury action.** The existing `/` and `/thesis` behavior is preserved. [Current review and operating checkpoint](../docs/10x/07-holder-research-review.md).

## Review

- [Discover](https://app-local.10x.meme/discover): live observed candidates, separate eligible/provisional/excluded views and explicitly synthetic examples.
- [Data status](https://app-local.10x.meme/status): freshness, bounded coverage, UTC provider quotas and pause/error state.
- [Daily review](https://app-local.10x.meme/research): immutable selection features, 24-hour outcomes, chronological holdout proposals and wallet associations to investigate.
- [Admin](https://app-local.10x.meme/admin/10x): operator-token protected jobs, pause/resume, refresh and election dry run.
- `/token/solana/:mint`: independent creation and graduation proofs, full addresses, risk and market gaps, explorer links and retained evidence hashes.
- [OpenAPI](openapi.json): public read contracts and restricted local admin endpoints.

The title dropdown includes **Discover Solana** in development. Discovery routes and proxy exist only in the Vite development surface. The discovery Worker refuses non-loopback runtime hostnames and never binds remote storage. No deployment script is provided.

## Start

Use the repository's existing pnpm installation and frozen dependency graph. The discovery package reuses already-installed package versions; no new package version was downloaded for this milestone.

```powershell
pnpm install --filter 10x-discovery-local --offline --frozen-lockfile --ignore-scripts
pnpm --dir discovery local
```

The launcher creates an ignored `discovery/.dev.vars` containing a random 64-character operator token. It initializes the separate `discovery/.wrangler/local` D1 store, starts the local Worker on `127.0.0.1:8794`, and runs a 60-second local timer. No Cloudflare cron or remote resource is created. The default local launcher enables free GeckoTerminal enrichment and a loopback Node relay; checked-in config keeps both off until explicitly configured.

On this Windows workstation, current-user scheduled task **10X-Discovery-Local** starts the hidden supervisor at login and checks every five minutes. It requires no password or administrator role. The supervisor holds a process lock, checks health, restarts only its owned launcher and preserves the local database. Reinstall with `./scripts/install-discovery-local-task.ps1`; inspect using `Get-ScheduledTaskInfo -TaskName 10X-Discovery-Local`. The workstation must be awake and the user logged in. This is a local OS task, not a Codex cloud automation or remote scheduler.

The 60-second timer checks three independent loops: heartbeat/daily review, a three-minute market batch and budget-paced chain verification. Reviews catch up hourly for the previous three Australia/Sydney days. Market refresh uses one free request for up to 30 pools, rotating attempted addresses so missing pools do not monopolize the queue. Source work respects pause; cached daily reviews continue without providers. A hard budget pauses source calls until the next UTC budget day; no paid upgrade occurs.

The existing app/tunnel also needs to be running. For this workstation it uses Vite port 5183, API port 8788, the separate `app/.wrangler/10x-preview` store, and the existing named `app-local` tunnel. The Vite-only `/api/10x` proxy forwards to port 8794.

```powershell
$env:APP_LOCAL_VITE_PORT = '5183'
$env:APP_LOCAL_PERSIST_TO = '.wrangler/10x-preview'
pnpm --dir app local:tunnel
```

Do not start second copies if the ports are already occupied. Other apps on this computer use different Node/Cloudflare processes; do not terminate them indiscriminately. The discovery launcher stops its own child process tree on Ctrl+C. If started hidden, stop only that launcher and its descendants. Keep the ignored operator token out of screenshots, source control and logs. The CLI reads it automatically; the browser admin page accepts it only into memory, without local/session storage.

## Operator commands

Run from repository root:

```powershell
node scripts/discovery-operator.mjs status
node scripts/discovery-operator.mjs jobs
node scripts/discovery-operator.mjs refresh
node scripts/discovery-operator.mjs pause
node scripts/discovery-operator.mjs resume
node scripts/discovery-operator.mjs fixtures
node scripts/discovery-operator.mjs dry-run
node scripts/discovery-operator.mjs review
node scripts/discovery-operator.mjs market-refresh
```

Refresh is idempotent per UTC minute and respects a database lease, pause/backoff and daily quotas. A running job can cause a manual refresh to return `skipped`; this is expected. Dead leases expire after ten minutes. Refresh never grants financial permissions. Fixture rows have `mode=fixture`, are absent from live reads and cannot enter a live-input election dry run. A policy preview can inspect different proposed thresholds without activating them.

## Verification

1. Check the RPC's full mainnet genesis hash. Every signature search, transaction read and account read requests finalized commitment.
2. Derive Pump's global PDA and read its canonical migration authority from the pinned Global account prefix. Harvest up to 30 recent finalized successful signatures every five minutes into a durable inbox; process up to six per tick. A full window is a coverage limitation, not an exhaustive chain index.
3. Decode actual Pump `migrate`/`migrate_v2` instruction bytes and account indices, including v0 loaded addresses and inner instructions. Require canonical mint/curve/pool authority/pool PDAs and a matching nested PumpSwap `create_pool` CPI. Successful no-op migrate calls without pool creation do not become graduation proofs.
4. Search up to three pages of 1,000 bonding-curve signatures and inspect at most three oldest successful transactions in the bounded window. Decode canonical Pump `create`/`create_v2` independently. Missing history or unsupported transaction versions stays provisional. A new pool, `complete=true`, metadata timestamps and a token symbol never establish creation.
5. Read finalized mint/pool/vault/curve accounts at a context slot at least as recent as the migration. Validate account owners/discriminators, matching mints, canonical pool and token vault PDAs, initialized nonzero reserves, curve completion, mint/freeze authorities, and certified Token-2022 extensions. Only MetadataPointer/TokenMetadata extensions are accepted in this slice.
6. Persist immutable independent transaction proof records, normalized transaction payloads/hashes and finalized account snapshots/hashes. Candidate state is deduplicated by Solana mint. A conflicting immutable proof fails closed. Proof links expose saved evidence without triggering provider requests.
7. Re-evaluate token creation age, authority risk, source age, nullable market cap and liquidity under a versioned proposed local policy. FDV never fills missing market cap. A deterministic display ordering and global maximum 100 are separate from future community voting.
8. Request a finalized mint-filtered token account inventory, bounded to 5,000 accounts and a 166-byte slice. Retain original RPC account size to reject sliced multisig impersonation; validate token-account layout/type and owners; aggregate positive balances by token owner; exempt only the exact derived canonical vault; reconcile all balances to finalized mint supply with a context gap of at most 150 slots. Partial, unsupported, stale or supply-mismatched inventories cannot pass. Size-certified `owners-v2` is required by the holder gate; earlier prefix-only evidence remains replayable but cannot pass eligibility.

The pinned descriptor is [protocol/pump-schema.json](protocol/pump-schema.json), extracted from official IDLs at commit `639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22`, with original IDL SHA-256 values recorded. RPC-attested verification trusts the selected RPC; this is not an independently replaying Solana validator or proof of scam resistance.

Recorded mainnet fixtures and synthetic fixtures are separate. The real creation and graduation examples initially captured concern different assets; a negative test prevents joining them. The additional paired fixture records independently verified creation and migration for the same actual mint, `8bs3RnbY625UbLxM919AP4Xj1AsWd9gR6sGVTv2ppump`, with provenance and finalized account state. Recorded fixtures replay offline and do not make current-price/eligibility claims.

## Budgets and boundaries

| Setting | Default local value | Behavior |
|---|---|---|
| `TENX_RPC_DAILY_LIMIT` | 5,000 | Atomic D1 reservation per attempted free public RPC call; paced across the day, pause/backoff at exhaustion |
| `TENX_MARKET_DAILY_LIMIT` | 600 | Separate free enrichment budget; stale/null values remain visible |
| `TENX_MARKET_ENABLED` | Checked-in false; local launcher true | GeckoTerminal research enrichment; no DEX Screener dependency |
| `TENX_NODE_RELAY` | Checked-in false; local launcher true | Development-only loopback read relay for native local networking |
| `TENX_LOCAL_ONLY` | true | Non-loopback Worker runtime hostnames fail closed |
| `TENX_ADMIN_TOKEN` | Empty in config; generated in ignored file | Empty/short keys never authenticate |

The Node relay binds only `127.0.0.1:8795`, requires the local token, rejects transaction broadcast/airdrop/simulation methods, rejects arbitrary target URLs, bounds bodies, and uses normal certificate-verified HTTPS to the fixed public RPC/GeckoTerminal endpoints. It is not exposed by the Vite proxy. The Worker still reserves quotas and validates every response. The relay addresses a local runtime transport difference; it is not a production architecture commitment.

One candidate is investigated per paced chain cycle, with later retries/refreshes scheduled in D1. Separate three-minute market batches sample the displayed list and recent outcome cohorts using at most 600 requests/day. Approximately 60-second prices for 100 tokens is **not achieved** by this conservative free budget. Price/risk timestamps are explicit; missing and stale fields remain provisional. Charts use actual saved observations and break across missing values or gaps over 30 minutes. No synthetic historical chart is mixed into live data. Missing market cap remains missing, even when FDV exists. Token images come only from validated provider inclusion metadata and allowlisted public HTTPS image gateways; failures show initials.

Market-data terms/redistribution rights remain a production gate. This local experiment does not claim production permission. No paid plan or spending authority was configured. Owner concentration is implemented; beneficial-owner clustering, custody labeling, bundle risk, LP lock status, actual fees produced and buyer-wallet history remain unknown. Other quote mints, launchpads and chains are uncertified. Legacy/v0 transactions are supported; unsupported newer versions are recorded as gaps, not guessed.

The versioned proposed local policy requires at least 100 positive-balance non-vault owners, largest owner at most 10%, top ten at most 35%, creation-instruction user at most 5%, and holder evidence no older than 30 minutes. Shares use total minted supply. Unknown custody is counted conservatively as a holder, never exempted by a name or guess. These are engineering starting parameters, not an approved published eligibility policy or a guarantee of organic ownership.

Daily research freezes first observation and first eligible recommendation separately, including policy and source hashes. It measures sampled 24h return, drawdown and liquidity change; missing/delayed endpoints are pending or insufficient, never zero-filled. Reports retain revisions. At least 40 measured outcomes and adequate chronological train/holdout feature coverage are required for a proposal; the holdout must show a loss-precision improvement of at least 10 percentage points over baseline. Proposals remain inactive. Wallet associations require repeated distinct-token loss associations across retained 30-day reports, carry evidence hashes, and never assert fraud or automatically ban wallets. Fee, bundle and buyer-risk features explicitly stay unknown.

## Validation

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
```

Tests cover real/synthetic proof replay, mismatched assets/programs/PDAs, failed/undated transactions, v0 addresses, vault/authority risk, 24h boundaries, caps/deduplication/determinism, null-cap/FDV distinction, stale snapshots, provider outages/429s, bounded bodies, quota races, leases, immutable evidence, API validation/pagination, admin authorization/origin checks, local-only runtime, fixture isolation and no financial capabilities. The relay test confirms its token requirement and read-only URL/method restrictions. Production build includes the performance-budget check; building does not deploy.

This is an operational local discovery slice, not completion of the full PRD. Remaining work includes beneficial-owner/insider clustering, organic-trading and fee verification, LP lock analysis, deeper archival coverage/new transaction-version certification, market-data rights, longer unattended/fault exercises and approved live eligibility policy. Wallet-backed voting, AMM simulation/devnet proof, launch contracts, rewards and treasury remain future gated milestones.

Primary references: [Pump program](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/PUMP_PROGRAM_README.md), [pinned Pump IDL](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/idl/pump.json), [pinned PumpSwap IDL](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/idl/pump_amm.json), [Solana getTransaction](https://solana.com/docs/rpc/http/gettransaction), [getSignaturesForAddress](https://solana.com/docs/rpc/http/getsignaturesforaddress), [getMultipleAccounts](https://solana.com/docs/rpc/http/getmultipleaccounts), [mainnet genesis reference](https://solana.com/docs/payments/agentic-payments/x402), [Cloudflare D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/).
