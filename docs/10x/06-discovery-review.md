# Solana discovery morning review

Checkpoint: 20 October 2026, Australia/Sydney. This is a working local discovery milestone, not completion of the full PRD. No push, deployment, paid service, remote database migration, signer or onchain write was performed for this milestone.

## Review in the running app

- [Discover](https://app-local.10x.meme/discover): observed live tokens, eligibility reasons and a separate simulation view.
- [Data status](https://app-local.10x.meme/status): source freshness, coverage limits, UTC quotas and pause/error state.
- [Example with both proofs](https://app-local.10x.meme/token/solana/8bs3RnbY625UbLxM919AP4Xj1AsWd9gR6sGVTv2ppump): separate finalized creation and graduation transactions, slots, saved payload hashes and explorer links. The token name is untrusted onchain input; verification is not an endorsement.
- [Local admin](https://app-local.10x.meme/admin/10x): authenticated jobs, refresh, pause/resume and election dry run. The operator CLI reads the ignored local key automatically; the browser starts locked.
- [Empty homepage](https://app-local.10x.meme/) and [The 10X Thesis](https://app-local.10x.meme/thesis) remain available.

The existing tunnel previews services running on this workstation; no new hosted application was deployed. Leave the workstation awake for continued refresh. The launcher runs a bounded 60-second timer, with persistent pause/backoff and request budgets. Preview reads use the saved database and never request external source data.

The final local API check observed **9 live candidates: 0 eligible, 3 provisional, 6 excluded**. This is a changing snapshot, not a coverage claim. No token can currently pass the required holder-concentration evidence gate. The dry run returned `no_eligible_winner`, with launch capability false.

## What changed

| Files | Result |
|---|---|
| `discovery/src/pump.ts`, `solana.ts`, `rpc.ts`, `protocol/pump-schema.json` | Pinned official Pump/PumpSwap layouts; separate canonical creation and migration verification, legacy/v0 and CPI support, account/PDA/authority/vault checks, finalized evidence |
| `discovery/src/ingest.ts`, `store.ts`, `model.ts`, `market.ts`, `migrations/` | Durable inbox, idempotent refresh jobs and leases, quota reservations/backoff, immutable proof/account snapshots, deduplication, age/risk/market evaluation and global maximum 100 |
| `discovery/src/worker.ts`, `openapi.json` | Validated read APIs, freshness/coverage metadata and authenticated local controls; no financial permissions |
| `discovery/src/*.test.ts`, `fixtures/recorded/` | Offline synthetic and real mainnet evidence replay; paired and deliberately mismatched assets; negative verification/API/provider tests |
| `app/src/discovery/`, `App.tsx`, `main.tsx`, `vite.config.ts` | Discover, token evidence, status and admin screens, development routes/menu entry and development API proxy |
| `scripts/*discovery*`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | Local launcher, restricted read relay, operator commands, running-service check and schema/OpenAPI generation; reuse existing dependency versions |
| `discovery/README.md`, `docs/10x/README.md`, this checkpoint | Operations, configuration, evidence algorithm, limits and review instructions |

Creation is established by a successful canonical Pump `create`/`create_v2` instruction for the mint. Graduation independently requires canonical Pump migration plus a matching nested PumpSwap pool-creation instruction. A new pool, token symbol, metadata timestamp or completed curve cannot substitute for either proof. Current account verification is retained separately from the historical transaction proofs.

The adapter pins official IDLs at commit `639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22`, with original hashes in the descriptor. Verification trusts the finalized RPC response; it does not independently replay validator consensus. Fixture and live candidate namespaces are isolated in storage and reads. Election dry runs use live inputs only.

## Commands and results

Commands were run from the repository root unless noted. All final checks below passed.

```powershell
pnpm install --filter 10x-discovery-local --offline --frozen-lockfile --ignore-scripts
pnpm install --filter 10x-app --offline --frozen-lockfile --ignore-scripts
pnpm --dir discovery types
pnpm --dir discovery exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
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

- Discovery: **42 tests passed**. Relay: **1 test passed**. Existing app: **773 tests passed across 128 files**.
- Type checks passed. Production bundle build and performance budget passed; the build did not deploy.
- Running-service check: validated response schemas, candidate bounds and live/fixture isolation; replayed a saved live creation/graduation pair and its current account snapshot with matching hashes; unauthenticated admin returned 401 and authenticated jobs returned 200; dry-run launch capability remained false. It made **zero source-provider requests**.
- Browser checks covered the live list, independent proof detail, status/freshness/quotas and locked admin controls. Screenshots are saved locally under ignored `.tmp/10x-discovery.png` and `.tmp/10x-evidence.png`.
- Local migrations applied to the separate discovery store only. Existing app preview retains its separate `.wrangler/10x-preview` store.

The first broad offline install encountered the repository's existing `localflare` dependency security constraint. The scoped frozen installs succeeded without relaxing that rule or downloading new versions. The installed workerd supports compatibility date `2026-09-01`; this local config uses that date rather than an unsupported newer date. A loopback Node read relay addresses local Worker networking differences using normal TLS validation.

## Configuration and deployment impact

`discovery/wrangler.local.jsonc` has no deployment script or remote database. It requires local runtime mode and loopback hostnames, disables Workers preview URLs, and uses isolated local persistence. Discovery screens and proxy are development-only routes. Existing public deployment configuration was not changed.

| Toggle | Checked-in / running local value |
|---|---|
| `TENX_LOCAL_ONLY` | true / true |
| `TENX_RPC_DAILY_LIMIT` | 3,000 attempted calls per UTC day |
| `TENX_MARKET_DAILY_LIMIT` | 600 attempted calls per UTC day |
| `TENX_MARKET_ENABLED` | false / true in ignored local variables |
| `TENX_NODE_RELAY` | false / true in ignored local variables |
| `TENX_ADMIN_TOKEN` | empty / random key in ignored `.dev.vars` |
| Voting, signing, launches, rewards, social publishing | all false |

The read relay binds `127.0.0.1:8795`, requires the operator key, restricts URLs and RPC methods, bounds bodies and rejects transaction broadcast. The local Worker is on 8794; existing app Vite is on 5183 and app API on 8788. Secrets, state, dependencies and logs are ignored by Git. To inspect or pause without displaying the key:

```powershell
node scripts/discovery-operator.mjs status
node scripts/discovery-operator.mjs jobs
node scripts/discovery-operator.mjs pause
node scripts/discovery-operator.mjs resume
```

## Open gaps and next step

1. Holder/custody/LP classification remains unimplemented and blocks eligibility. Implement and certify those checks before considering any token eligible.
2. Discovery is a bounded migration-authority scan, not an exhaustive index. Origin search stops at 3,000 curve signatures and three historical transactions; missing archival data and unsupported newer transaction versions remain explicit gaps. Only canonical WSOL-quoted PumpSwap pools are certified.
3. Free market enrichment does not meet 60-second refresh for 100 candidates. Cap can be null while FDV exists; FDV never replaces cap. Production market-data licensing/redistribution and batching remain unresolved. Budgets stop requests rather than purchase upgrades.
4. The proposed local liquidity/freshness policy is versioned; previewing another policy cannot activate it. No unresolved economic or financial authority decision was inferred.
5. A sustained fault/soak exercise, economic simulator, AMM/devnet launch proof, wallet-backed voting and all later financial phases remain outstanding. No claim of production readiness is made.

Recommended next implementation: certified holder analysis with replayable owner/LP classification evidence, followed by a bounded unattended fault exercise. Keep discovery local until these evidence and provider gaps are reviewed.
