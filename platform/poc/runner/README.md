# Local browser-wallet POC runner

An isolated Node application at `http://127.0.0.1:4195`. It does not change the customer app, Worker bindings, deployment workflows or production financial capabilities. Mainnet operations require the user's browser-wallet signature. No wallet secrets are persisted or read from the earlier DPAPI lab wallets.

## Start

Use Node 22.16+ (tested 22.22.3) and pnpm 10.26. From the repository root:

```powershell
pnpm --dir platform/poc/runner install --frozen-lockfile --ignore-scripts
pnpm --dir platform/beacon install --frozen-lockfile --ignore-scripts
node platform/poc/runner/server.mjs
```

On the restored Windows machine, `platform/poc/runner/start.ps1` uses `C:\dev\tools\node22\node.exe`, with PATH fallback. Dependencies have already been installed. Leave the terminal open, or use the already-running local instance. Only one instance can own `%LOCALAPPDATA%\SolanaPocRunner\evidence.sqlite`.

## Mobile access through the existing tunnel

`start-mobile.ps1` prepares `https://app-local.10x.meme/poc/` on the existing local connector, preserving the current application at `/`. It generates a private 256-bit access key under `%LOCALAPPDATA%\SolanaPocRunner\mobile.json`, validates the scoped ingress rule, and restarts only the runner and connector. It refuses to restart while a financial attempt or local check is pending. Run it from the Windows host when activating mobile access:

```powershell
& .\platform\poc\runner\start-mobile.ps1
```

The script prints a private link with `#access=...`. The fragment is exchanged for a 12-hour Secure/HttpOnly/SameSite=Strict cookie scoped to `/poc/`, then removed from the address bar. Keep the link private; unauthenticated requests cannot read evidence, export it, or execute actions. The local computer must stay awake with the runner and connector running. Safari can review the page; signing requires a compatible wallet's in-app browser. Physical-phone wallet support remains an acceptance check, not a claimed result.

Tunnel mode is opt-in via `mobile.json`; without it the server remains loopback-only. The configured HTTPS Host and route prefix must match exactly, and forwarded requests masquerading as loopback are rejected. All transaction CSRF, message, signature and budget checks remain active. No Cloudflare deployment, new DNS record, or financial transaction is part of startup.

To revoke mobile access, stop the scoped runner, remove or rotate `mobile.json`, and restart it; existing cookies then fail. To remove the route, restore `work/app-local-tunnel-restored.yml.before-poc` over the corresponding YAML and restart only that connector. Preserve `evidence.sqlite` and unresolved attempts. Access credentials and machine-specific tunnel configuration are never committed.

Implementation was validated with HTTP authorization tests and a 390px mock-browser login/reload test. Live tunnel activation was initially blocked by automatic approval review on 26 November; do not treat these local tests as a successful public-route verification.

## Executable coverage

| POC | Page functionality | Outside the live adapter |
| --- | --- | --- |
| P00 | Local checks, genesis/price observation, evidence/export, run identity | Physical wallet qualification, production acceptance |
| P01 | Classic SPL original/ATT mint, fixed supply, revoked mint authority, token transfer | Official launch mechanism, fungible metadata, Token-2022 extensions |
| P02 | DAMM v2 pair, permanent LP lock, quote/swap both directions, fee collection | All boundary-second live trades, independent market/pricing validation |
| P03 | Four payer-owned accounts for the remaining 20%; exact raw-unit postconditions | Enforced vault custody, overlapping real campaigns, on-chain fallback |
| P04 | Local farm arithmetic/readiness and captured configuration checks; notes | Live deposits blocked pending principal-custody design |
| P05 | Rewards single-leaf distribution/claim, accelerated 60+60-second vesting; Earn tests | Real social-feed capture, full-duration/large-proof/NFT-bound distributions |
| P06 | Core create/transfer, finalized current-owner check; economics/claim tests | Economic attributes, reserve binding, burn protection, transferable claims |
| P07 | Fairness, mint planning/recovery/fulfillment tests; notes | Selected randomness/payment/storage provider and fulfillment/refund adapter |
| P08 | Progression/fairness/atomic-update tests; notes | On-chain progression with immutable rights and real randomness |
| P09 | Mock Wallet Standard coverage, manual wallet/marketplace evidence | Actual mobile/marketplace signing, sale/escrow/royalty adapters |
| P10 | Recovery checks, durable attempts, unknown/finalized receipts, export | Integrated campaign, multi-day observations, unknown-signature investigation |

All POCs have runnable local checks. **This is not an executable complete mainnet campaign.** Unsupported funded paths are explicitly absent. Product acceptance remains open even when a narrower probe finalizes.

## Transaction lifecycle

**Prepare** checks prerequisites, the run wallet, mainnet genesis and relevant saved program binary/authority pins. It builds an allowlisted action, partially signs newly created accounts with ephemeral helpers, simulates, estimates payer debit plus fee, and reserves a 15% margin plus 10,000 lamports. Helper private keys are discarded; existing helper signatures survive in the packet. The payer signature is always missing until the browser wallet supplies it.

The page shows recipients, amounts, instructions, simulation logs, expiry, price observation and reserve. **Approve in browser wallet** uses Wallet Standard `solana:signTransaction`; wallets that only support sign-and-send are not accepted. The server verifies every signature and the exact original message, rechecks program pins/current costs, then persists the signature before one broadcast. It cannot complete a financial transaction without the user's wallet.

**Recover** reads signature status and the finalized receipt, binds the full message, charges realized payer debit once, and checks account/token-delta/lock postconditions. Only verified finalization unlocks dependent probes. Ambiguous attempts remain reserved, including after expiry if signed: one RPC's missing history is insufficient proof of non-execution. No automatic rebroadcast, replacement, reset-budget button or background mainnet action exists. A dropped ambiguous transaction needs independent operator investigation before adding a supported release path.

The ceiling is $10 across all attempts. Conversion uses public Coinbase SOL/USD spot observations at preparation and submission. Failed landed transactions still consume fees. Rent and locked assets count as spent; predicted refunds never replenish the allowance. This is a preflight reserve, not an on-chain dollar spending contract: an unexpected realized overrun records a hold. Program upgrades and price movement are not eliminated by preflight checks.

## Local boundaries and evidence

- Bind only IPv4 loopback; reject unknown Host, cross-origin requests, cross-site fetches, missing CSRF tokens, oversized bodies and generic RPC/instruction requests.
- SQLite WAL/FULL persists public artifacts, raw finalized receipts, attempts, costs, checks, and manual notes. No seed phrases, funded wallet private keys or external DB writes.
- Full packet bytes in export are partially signed but lack the payer signature until submission. Treat evidence as local operational data; do not publish the wallet/address mapping accidentally.
- Code identity includes Git HEAD and a platform code/config/fixture content hash. Each local run records exact files, exit status, logs and a digest. Truncated logs are explicitly marked. Interrupted jobs cannot become passes.
- Mock QA uses an in-memory chain and separate dynamic loopback port. Production CLI accepts no mock/RPC/network overrides.
- Public Solana RPC rate limits/outages fail closed; there is no subscription fallback. A compatible browser extension and adequate funding are needed for live steps.
- Local NFT metadata is not publicly indexed. No official name, image, ticker, branded URL or utility is used on-chain. Allocation accounts retain test tokens under the payer's control and are not production vaults.

## Validation

```powershell
pnpm --dir platform/poc/runner test
node platform/contracts/generate.mjs --check
# Set PLAYWRIGHT_MODULE and BROWSER_EXE to existing installations:
pnpm --dir platform/poc/runner test:browser
```

The page's **Run all local checks** executes the allowlisted P00–P10 repository files; tests do not broadcast. Browser QA signs ephemeral mock packets only, blocks external browser requests, and reports separately from physical-wallet testing.

Primary references: [Solana confirmation](https://solana.com/developers/cookbook/transactions/confirmation), [Meteora SDK](https://github.com/MeteoraAg/damm-v2-sdk), [Core asset creation](https://www.metaplex.com/docs/smart-contracts/core/create-asset). Exact dependencies are in the frozen lockfile. Captured wire layouts remain linked to repository fixtures and checked against live deployment fingerprints before use.
