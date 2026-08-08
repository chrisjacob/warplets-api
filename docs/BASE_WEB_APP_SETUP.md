# Base/web support setup

For the concrete preview-first commands and completion checklist, begin with
[`BASE_WEB_PREVIEW_PREREQUISITES.md`](./BASE_WEB_PREVIEW_PREREQUISITES.md).
Complete that runbook before the broader distribution-surfaces setup. This file
remains the detailed Base/web verification reference.

10X Warplets now treats Base App as a standard web browser while retaining the Farcaster Mini App runtime as its primary surface. No Base production resources are created by the code change.

## 1. Register the Base app

1. Create a project in [Base.dev](https://base.dev/) and register `https://warplet.10x.meme` as the primary app URL.
2. Add the 10X Warplets icon, description, category, screenshots and production URL. Add preview/local URLs only where the Dashboard offers an origin allowlist.
3. Create the Builder Code for 10X Warplets and copy it exactly. The client uses it to generate an ERC-8021 suffix with `ox`.
4. Generate a Base notifications API key in the project settings. Keep it server-side.
5. Use Base Dashboard as the source of truth for Base acquisition and onchain analytics. Product events continue to go to GA4 without FIDs or wallet addresses.

Recommended client build variables:

```dotenv
VITE_WEB_WALLET_ENABLED=true
VITE_BASE_ACCOUNT_ENABLED=true
VITE_TRUSTCONNECT_ENABLED=false
VITE_BASE_BUILDER_CODE=your-builder-code
VITE_WALLETCONNECT_PROJECT_ID=your-connection-only-project-id
VITE_NEYNAR_CLIENT_ID=your-neynar-client-id
```

Start with TrustConnect disabled. Base Account and the compatibility injected-wallet connector do not depend on it.

## 2. Create the WalletConnect connection-only project

TrustConnect is free/open source, but its mobile/QR transport still needs a WalletConnect project ID.

1. Create a connection-only project in the WalletConnect/Reown dashboard; do not add AppKit.
2. Allowlist `https://warplet.10x.meme`, `https://warplet-dev.10x.meme`, `https://warplet-local.10x.meme`, and the exact localhost origin used by Vite.
3. Put the public project ID in `VITE_WALLETCONNECT_PROJECT_ID`.
4. Run the TrustConnect proof checklist below before changing `VITE_TRUSTCONNECT_ENABLED` to `true`.

TrustConnect packages are deliberately pinned to `0.0.0`. Do not use a floating range until the project publishes formal releases and a migration policy.

## 3. Configure Cloudflare secrets and variables

Generate a random session secret of at least 32 characters. Configure secrets independently for preview and production:

```powershell
pnpm --dir app exec wrangler pages secret put APP_SESSION_SECRET --project-name 10x-app
pnpm --dir app exec wrangler pages secret put BASE_NOTIFICATIONS_API_KEY --project-name 10x-app
```

Also ensure `NEYNAR_API_KEY` and `ACTION_SESSION_SECRET` remain configured. SIWN verification uses the Neynar signer lookup; Farcaster Mini App sessions use Quick Auth.

The non-secret runtime variables are in `app/wrangler.toml`:

- `BASE_APP_URL=https://warplet.10x.meme`
- `BASE_NOTIFICATIONS_ENABLED=false`

After validating the Base API key and registered URL in preview, set `BASE_NOTIFICATIONS_ENABLED=true` for that environment. The Base notification API is limited to 20 requests per minute, 1,000 wallets per send, and deduplicates identical messages for 24 hours.

## 4. Apply the database migration

Migration `0047_app_identity_and_base_notifications.sql` adds hashed sessions, single-use SIWE nonces, verified FID/wallet links, the short-lived Base status cache, and per-channel notification delivery/attempt records.

Apply it to preview first using the repository's normal D1 migration workflow. Inspect the target database before running any remote migration. No migration or deployment is performed automatically by this implementation.

## 5. Verify the wallet integrations

Test these cases in preview:

- Farcaster Mini App: Quick Auth identity, embedded wallet connection, SIWE proof, account change and disconnect.
- Base App iOS/Android: Base Account connect, Base Mainnet selection, SIWE, typed-data order signatures, ordinary transactions and supported atomic batches.
- Standard mobile/desktop browsers: anonymous reading, Base Account, injected wallet and SIWN identity.
- TrustConnect proof: EIP-6963 wallet, WalletConnect QR/mobile, reload/reconnect, disconnect, Base chain switching, SIWE, `personal_sign`, typed-data signing and ordinary transactions.
- Confirm WalletConnect falls back to sequential transactions when EIP-5792 capabilities are absent.

If any TrustConnect proof fails, leave it disabled. The Base Account and injected options remain available.

## 6. Verify Builder Codes

1. Submit an ordinary web-wallet transaction and inspect its calldata on a Base block explorer for the configured ERC-8021 suffix.
2. Submit through Base App/Base Account and confirm it appears in Base Dashboard.
3. Test an approval/WETH wrap and a marketplace fulfillment. For supported `wallet_sendCalls`, verify the optional `capabilities.dataSuffix` attribution.
4. Confirm host-added and app-added attribution are not counted twice. The implementation avoids asking Base Account to auto-generate attribution and owns the suffix at the transaction adapter.
5. Seaport order signatures are offchain and cannot contain Builder Codes; verify those through GA4 product events instead.

## 7. Verify Base notifications

1. Pin the app and enable notifications in Base App for a test wallet.
2. Connect that wallet in 10X Warplets and use **Enable notifications** to confirm status. The UI must only explain how to pin/enable; it must not claim to enable Base notifications programmatically.
3. From the admin page select Farcaster, Base, or Both and send a unique test campaign ID.
4. Verify per-channel deduplication, the Base audience paginator, a linked user receiving both channels, opt-outs, invalid recipients, 429/503 retry behavior, opens and clicks.
5. Keep `BASE_NOTIFICATIONS_ENABLED=false` until this passes.

## Security notes

- A Farcaster verified/custody address is never treated as a signer.
- Wallet and Farcaster principals are independent and can be linked only after both proofs; differing identities require explicit confirmation.
- SIWE nonces expire after five minutes and are consumed atomically once.
- Sessions are HttpOnly, hashed in D1, slide for 30 days and have a 90-day absolute limit.
- Wallet account changes immediately clear wallet authentication.
- WalletConnect WebSockets are restricted by CSP to the two WalletConnect relay hosts rather than all WebSocket origins.
