# Local Solana discovery

Implemented 20 October 2026. **Local runtime only. No deployment, signer, transaction broadcast, token mint, live voting, reward payment or treasury action.** The existing `/` and `/thesis` behavior is preserved.

## Review

- [Discover](https://app-local.10x.meme/discover): live observed candidates, separate eligible/provisional/excluded views and explicitly synthetic examples.
- [Data status](https://app-local.10x.meme/status): freshness, bounded coverage, UTC provider quotas and pause/error state.
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

The pinned descriptor is [protocol/pump-schema.json](protocol/pump-schema.json), extracted from official IDLs at commit `639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22`, with original IDL SHA-256 values recorded. RPC-attested verification trusts the selected RPC; this is not an independently replaying Solana validator or proof of scam resistance.

Recorded mainnet fixtures and synthetic fixtures are separate. The real creation and graduation examples initially captured concern different assets; a negative test prevents joining them. The additional paired fixture records independently verified creation and migration for the same actual mint, `8bs3RnbY625UbLxM919AP4Xj1AsWd9gR6sGVTv2ppump`, with provenance and finalized account state. Recorded fixtures replay offline and do not make current-price/eligibility claims.

## Budgets and boundaries

| Setting | Default local value | Behavior |
|---|---|---|
| `TENX_RPC_DAILY_LIMIT` | 3,000 | Atomic D1 reservation per attempted provider call; pause/backoff at exhaustion |
| `TENX_MARKET_DAILY_LIMIT` | 600 | Separate free enrichment budget; stale/null values remain visible |
| `TENX_MARKET_ENABLED` | Checked-in false; local launcher true | GeckoTerminal research enrichment; no DEX Screener dependency |
| `TENX_NODE_RELAY` | Checked-in false; local launcher true | Development-only loopback read relay for native local networking |
| `TENX_LOCAL_ONLY` | true | Non-loopback Worker runtime hostnames fail closed |
| `TENX_ADMIN_TOKEN` | Empty in config; generated in ignored file | Empty/short keys never authenticate |

The Node relay binds only `127.0.0.1:8795`, requires the local token, rejects transaction broadcast/airdrop/simulation methods, rejects arbitrary target URLs, bounds bodies, and uses normal certificate-verified HTTPS to the fixed public RPC/GeckoTerminal endpoints. It is not exposed by the Vite proxy. The Worker still reserves quotas and validates every response. The relay addresses a local runtime transport difference; it is not a production architecture commitment.

One newly verified candidate is investigated per tick, with later retries/refreshes scheduled in D1. Approximately 60-second prices for 100 tokens is **not achieved** by this conservative free budget. Price/risk timestamps are explicit; missing and stale fields remain provisional. The timer may reach a daily budget during an unattended session; it then stops provider work rather than buying a plan. Existing provider backoff is preserved across restarts.

Market-data terms/redistribution rights remain a production gate. This local experiment does not claim production permission. No paid plan or spending authority was configured. Holder/custody/LP concentration classification is not implemented and deliberately blocks eligible status under the checked-in policy. Other quote mints, launchpads and chains are uncertified. Legacy/v0 transactions are supported; unsupported newer versions are recorded as gaps, not guessed.

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

This is an operational local discovery slice, not completion of the full PRD. Remaining work includes certified holder analysis, deeper archival coverage/new transaction-version certification, licensed price batching, longer unattended/fault exercises, approved live eligibility policy and a deployed scheduler only after a separate release instruction. Wallet-backed voting, AMM simulation/devnet proof, launch contracts, rewards and treasury remain future gated milestones.

Primary references: [Pump program](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/docs/PUMP_PROGRAM_README.md), [pinned Pump IDL](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/idl/pump.json), [pinned PumpSwap IDL](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/idl/pump_amm.json), [Solana getTransaction](https://solana.com/docs/rpc/http/gettransaction), [getSignaturesForAddress](https://solana.com/docs/rpc/http/getsignaturesforaddress), [getMultipleAccounts](https://solana.com/docs/rpc/http/getmultipleaccounts), [mainnet genesis reference](https://solana.com/docs/payments/agentic-payments/x402), [Cloudflare D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/).
