# 10X distribution surfaces: setup and rollout

This implementation keeps Farcaster Mini App and the central 10X Warplets application
canonical. PWA, X, bots, the Agent API and 10X Tabs are entry points around the
same verified identity, wallet and data boundaries.

> **Prerequisite:** Complete
> [`BASE_WEB_PREVIEW_PREREQUISITES.md`](./BASE_WEB_PREVIEW_PREREQUISITES.md)
> first. It configures the preview session secret, Base.dev project, Builder
> Code, WalletConnect project, feature flags and migration 0047. Do not use this
> runbook to skip those unfinished steps.

Nothing in this change creates Cloudflare resources, registers OAuth clients,
installs bots or enables paid requests automatically.

## 1. Apply migrations in preview

Migration `0047_app_identity_and_base_notifications.sql` must already have been
applied and verified through the prerequisite runbook. Apply
`0048_distribution_surfaces.sql` and `0049_warplets_app_identity.sql` only after that gate passes. Migration 0048
preserves the existing Farcaster/Base delivery history while replacing the
two-channel constraint with the generalized channel model. Migration 0049 changes
whole-application identity values and schema defaults from `search` to `warplets`.

```powershell
pnpm --dir app exec wrangler d1 migrations apply warplets_preview --remote --env preview
```

Inspect the preview database first and use the repository's established D1
command if its database selector differs. Only migrate production after preview
auth, API-token and bot-link isolation tests pass.

## 2. API Worker and archived Snap

The existing `api.10x.meme` Worker keeps its D1/KV bindings, OpenSea/Dune cron,
admin route and `/img-proxy.jpg`. Configure:

- `WARPLETS_APP_ORIGIN=https://warplet.10x.meme`
- secret `BOT_SERVICE_TOKEN` (same random 32+ character value on API and bots)
- keep `X402_ENABLED=false` initially

Deploy the isolated `snap/` Worker before changing newly composed Snap URLs:

```powershell
pnpm --dir snap build
pnpm --dir snap exec wrangler deploy --env preview
```

Bind its preview custom domain, verify `/drop`, `/drop/poll` and `/drop/claim`,
then deploy/bind `snap.10x.meme`. Only after that should the old API Worker be
deployed. Old Snap POSTs must never redirect because their JFS audience is the
old origin.

Browser `GET /` returns temporary HTML. A request explicitly accepting
`application/vnd.farcaster.snap+json` receives the retirement Snap. `/v1/*`,
`/mcp`, the cron and the historical image proxy remain independent.

## 3. Agent API, MCP and personal tokens

Public reads are available under `/v1`; discovery is
`https://api.10x.meme/v1/openapi.json`. MCP uses JSON-RPC over `POST /mcp` and
exposes equivalent tools. Public reads permit CORS; authenticated mutations do
not infer identity from submitted wallet/FID/platform IDs.

Connect and verify a wallet in 10X Warplets, then open **Developer API** from the user
menu. Tokens are shown once, stored only as SHA-256 hashes, revocable and scoped
to favourites, alerts or Stats shares.

Set the same `BOT_SERVICE_TOKEN` secret on `api` and `10x-channel-bots`. The bot
Worker supplies a platform ID only after Telegram webhook-secret verification or
Discord Ed25519 interaction verification. The API accepts those IDs only with
the service secret.

### x402 Sepolia pilot

Keep the pilot disabled until a recipient and facilitator are configured:

- `X402_ENABLED=true`
- `X402_NETWORK=eip155:84532`
- `X402_ASSET=0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Base Sepolia USDC)
- `X402_PRICE_USDC=10000` (`$0.01`, six decimals)
- secret `X402_PAY_TO`
- secret `X402_FACILITATOR_URL`

The only paid route is `POST /v1/paid/stats-report`; payer addresses are stored
only in settlement receipts and are never linked to application identity.
Enable Base Mainnet only after replay, duplicate-charge, settlement-failure,
refund and accounting tests pass.

## 4. PWA and Web Push enrollment

For the complete local setup, production rollout, verification and rollback
procedure, see [`WEB_PUSH_SETUP.md`](./WEB_PUSH_SETUP.md).

The Search and 10X.MEME builds include app-specific manifests, service-worker
branding and explicit online-required fallbacks. Neither app caches the Search
database or marketplace data offline.

Generate a P-256 VAPID key pair and configure:

- public variable `VAPID_PUBLIC_KEY`
- secret `VAPID_PRIVATE_KEY`
- secret/variable `VAPID_SUBJECT=mailto:notifications@10x.meme`

For `warplet-local` or `app-local`, generate a development-only key pair:

```powershell
pnpm --dir app web-push:generate-keys
```

The command prints four PowerShell commands beginning with `$env:`. Copy and
run those printed commands in the **same PowerShell window**. Do not run the
unprefixed `VAPID_PUBLIC_KEY=...` form—PowerShell does not support that syntax.
Do not put the private key in Git.

The generated output will look like this:

```powershell
$env:VAPID_PUBLIC_KEY="<generated-public-key>"
$env:VAPID_PRIVATE_KEY="<generated-private-key>"
$env:VAPID_SUBJECT="mailto:notifications@10x.meme"
pnpm --dir app local:tunnel:app
```

The tunnel launchers pass these values only to the local Pages Worker. Confirm
setup after restart with the app's `/api/web-push/public-key` endpoint;
it should return `200` with a `publicKey` rather than `503`. Reuse this same
local pair across restarts if you want existing browser subscriptions to remain
valid. A newly generated pair invalidates subscriptions created with the old
public key.

Enrollment, unsubscribe storage, campaign delivery and notification-open
tracking are implemented. Anonymous subscriptions are limited to general
announcements; personal topics require a verified session. Subscriptions are
scoped to the originating application, and permanent `404`/`410` responses
disable stale endpoints. The notification admin supports Web Push alone or in
combination with Farcaster and Base; repeat sends are idempotent for already
delivered campaign/subscription pairs.

On iOS/iPadOS, install to Home Screen first and request notification permission
from the user's button gesture. Embedded WebViews do not show PWA install UI.

## 5. X WebView and OAuth

X remains an untrusted standard-web entry point. `source=x` is analytics only;
it never authenticates a user. Safe-area and dynamic viewport handling are
enabled, and wallet signing continues through the central web wallet controller.

Register an X OAuth 2.0 application with exact callback URLs, then configure:

- build variable `VITE_X_AUTH_ENABLED=true`
- variable `X_CLIENT_ID`
- secret `X_CLIENT_SECRET` when using a confidential client
- `X_OAUTH_CALLBACK_URL=https://warplet.10x.meme/api/auth/x/callback`

Register preview and local callbacks separately. The implementation uses state,
a five-minute single-use challenge and PKCE. X identity remains separate from
wallet and Farcaster identity. No native X WebView bridge is trusted until X
publishes a signed, documented interface.

## 6. Telegram and Discord

Deploy `bots/` only after the API service secret is configured. The Worker has a
Service Binding named `TENX_API` and an HTTPS fallback for local development.

Telegram secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- 10X Warplets Pages variable `TELEGRAM_OIDC_CLIENT_ID`
- 10X Warplets Pages secret `TELEGRAM_OIDC_CLIENT_SECRET`
- exact `TELEGRAM_OIDC_CALLBACK_URL`

Register the callback/allowed URL with BotFather. Set Telegram's webhook to
`https://bots.10x.meme/telegram` and supply the same webhook secret as its
`secret_token`.

Discord secrets/configuration:

- `DISCORD_PUBLIC_KEY`
- `DISCORD_APPLICATION_ID`
- `DISCORD_BOT_TOKEN` for the local command-registration script only
- 10X Warplets Pages variable `DISCORD_CLIENT_ID`
- 10X Warplets Pages secret `DISCORD_CLIENT_SECRET`
- exact `DISCORD_OAUTH_CALLBACK_URL`

Set the Discord Interactions Endpoint URL to
`https://bots.10x.meme/discord`. Register user and guild slash commands. The v1
Worker uses HTTP interactions, Ed25519 verification, immediate deferral and
Components V2; it uses no Gateway or privileged intents.

`/link` uses a ten-minute, single-use bot challenge. The website then verifies
the exact same Telegram account through OIDC or Discord account through OAuth,
requires SIWE, and asks for explicit confirmation. The bot receives no signing
authority.

Read commands and user-initiated replies are implemented. Proactive Telegram
and Discord fan-out is not enabled in this commit: outbound delivery
must enforce recorded per-topic opt-in at the final egress boundary rather than
accepting an arbitrary internal payload.

## 7. 10X Tabs developer experiment

The Chrome wrapper is in `extensions/10x-tabs` and pins Extension.js exactly.

```powershell
pnpm --dir extensions/10x-tabs stamp
pnpm --dir extensions/10x-tabs build
```

Audit the generated manifest: permissions and host permissions must both be
absent. Load the generated Chrome directory through `chrome://extensions` →
Developer mode → Load unpacked. Test New Tab conflicts, browser restart,
incognito limitations, existing website sessions and each wallet connector.

For a release, build from an exact clean commit, ZIP the generated directory,
publish its SHA-256 and immutable commit provenance in a GitHub release. Updates
remain manual. The hash pins only the wrapper; the top-level HTTPS 10X Warplets app can
still change through normal deployments. Do not reward install/source query
parameters and do not submit this redirect-only version to the Chrome Web Store.

## 8. Required verification gate

Before production enablement, run:

```powershell
pnpm build
pnpm --dir app test
pnpm --dir app typecheck
pnpm --dir app build
pnpm --dir snap build
pnpm --dir bots build
pnpm --dir extensions/10x-tabs build
git diff --check
```

Then test anonymous, wallet-only, Farcaster-only and combined sessions; OAuth
state/nonce replay; cross-user token access; REST/MCP parity; bot signature
failure; PWA install/push enrollment; X OAuth return continuity; and the x402
failure matrix. Never place raw FIDs, wallets or platform IDs in GA events.
