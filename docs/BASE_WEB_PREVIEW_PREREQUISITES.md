# Base/web preview prerequisites

Complete this runbook **before**
[`DISTRIBUTION_SURFACES_SETUP.md`](./DISTRIBUTION_SURFACES_SETUP.md). It covers
the Base/web foundation that has been implemented in code but has not yet been
configured remotely.

Complete the preview-domain and exact-domain Farcaster association steps in
[`WARPLETS_HOSTNAME_SETUP.md`](./WARPLETS_HOSTNAME_SETUP.md) for
`warplet-dev.10x.meme` before this runbook's preview smoke test.

This runbook deliberately activates only the preview environment. It does not
enable TrustConnect, Base notifications, production traffic, or a production
deployment.

## Completion record

- [ ] Cloudflare Wrangler login works.
- [ ] The Base.dev preview app and Builder Code exist.
- [ ] A Base notifications API key exists for the preview app URL.
- [ ] A connection-only WalletConnect project and origin allowlist exist.
- [ ] Preview `APP_SESSION_SECRET` is configured.
- [ ] Preview `BASE_NOTIFICATIONS_API_KEY` is configured.
- [ ] Preview public build variables are configured.
- [ ] `VITE_TRUSTCONNECT_ENABLED` remains `false`.
- [ ] Migration 0047 is applied to `warplets_preview` only.
- [ ] The preview build, authentication smoke tests and wallet smoke tests pass.

Do not start the distribution-surfaces runbook until every applicable box above
is checked.

## 1. Confirm access and targets

From the repository root:

```powershell
pnpm --dir app exec wrangler whoami
git branch --show-current
```

If Wrangler reports an expired login, run this in an interactive terminal:

```powershell
pnpm --dir app exec wrangler login
```

The intended preview targets are:

| Purpose | Target |
|---|---|
| Preview 10X Warplets URL | `https://warplet-dev.10x.meme` |
| Preview Pages project | The project/environment currently serving that URL |
| Preview D1 database | `warplets_preview` |
| Preview D1 database ID | `4ed108bd-9477-4109-930c-bc57b6c11b1f` |
| Base test chain | Base Sepolia (`84532`) |

In Cloudflare, open **Workers & Pages**, find the Pages deployment serving
`warplet-dev.10x.meme`, and note its exact project name. The current deployment
script uses `10x-app-dev`; confirm that in the dashboard rather than assuming
it has not changed.

Do not configure the preview secrets on the production `10x-app` environment.
Preview and production must use different session secrets and preferably
different Base notification API keys.

## 2. Register the preview app in Base.dev

1. Sign in to [Base.dev](https://base.dev/).
2. Create a separate preview/test project where possible, named something like
   `10X Warplets Preview`.
3. Register `https://warplet-dev.10x.meme` as its app URL. The URL used in Base
   notification requests must belong to the project that issued the API key.
4. Add the app name, icon, tagline, description, category and screenshots.
5. Create or assign a Builder Code and copy its exact value. Builder Codes are
   public identifiers; they are not secrets.
6. Under the project's API-key settings, create a Base notifications API key.
   Do not put this key in a `.env` file or `app/wrangler.toml`.
7. Leave Base notifications disabled in the application for now:

```toml
BASE_NOTIFICATIONS_ENABLED = "false"
```

That value is already set under `[env.preview.vars]` in
[`app/wrangler.toml`](../app/wrangler.toml).

If Base.dev does not allow the preview URL on the production project, keep the
projects separate. Do not use `warplet.10x.meme` as `BASE_APP_URL` in preview;
that would test against production users.

## 3. Create the connection-only WalletConnect project

TrustConnect's WalletConnect transport needs a public project ID even while the
TrustConnect UI remains disabled.

1. Create a project at [Reown Dashboard](https://dashboard.reown.com/).
2. Use it only for WalletConnect protocol connectivity; do not add Reown
   AppKit.
3. Add these exact web origins to its allowlist:

   - `https://warplet-dev.10x.meme`
   - `https://warplet-local.10x.meme`
   - the exact Vite origin you use locally, normally `http://localhost:5173`
   - `https://warplet.10x.meme` when preparing production

4. Copy the project ID. It is a public client build value, not a secret.
5. Do **not** enable TrustConnect yet.

An origin includes its scheme and port. `http://localhost:5173` and
`http://localhost:4173` are different origins and must be entered separately if
both are used.

## 4. Configure preview Cloudflare secrets

### `APP_SESSION_SECRET`

Generate a unique preview secret of 48 random bytes and send it directly to
Wrangler without writing it to disk. Replace `<PREVIEW_PAGES_PROJECT>` with the
project confirmed in step 1:

```powershell
$appSessionBytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Fill($appSessionBytes)
$appSessionSecret = [Convert]::ToBase64String($appSessionBytes)
$appSessionSecret | pnpm --dir app exec wrangler pages secret put APP_SESSION_SECRET --project-name <PREVIEW_PAGES_PROJECT> --env preview
Remove-Variable appSessionSecret, appSessionBytes
```

If the preview URL is served by a standalone Pages project whose active branch
is its production environment, use the dashboard instead of guessing the CLI
environment:

1. **Workers & Pages** → preview project → **Settings**.
2. Open **Variables and Secrets**.
3. Select the environment serving `warplet-dev.10x.meme`.
4. Add `APP_SESSION_SECRET` as an encrypted secret.

Rotating this value invalidates existing application sessions. Never reuse the
production value in preview.

### `BASE_NOTIFICATIONS_API_KEY`

Set the preview Base.dev API key as an encrypted secret in the same Pages
environment. Either use the dashboard, or run:

```powershell
pnpm --dir app exec wrangler pages secret put BASE_NOTIFICATIONS_API_KEY --project-name <PREVIEW_PAGES_PROJECT> --env preview
```

Wrangler prompts for the value. Paste it at the prompt; do not add it to source
control.

Confirm that existing preview secrets such as `NEYNAR_API_KEY` and
`ACTION_SESSION_SECRET` are still present. Do not rotate them as part of this
runbook.

## 5. Configure preview client build variables

These values are bundled into browser JavaScript and therefore must contain no
secrets:

```dotenv
VITE_WEB_WALLET_ENABLED=true
VITE_BASE_ACCOUNT_ENABLED=true
VITE_TRUSTCONNECT_ENABLED=false
VITE_BASE_BUILDER_CODE=<BASE_DEV_BUILDER_CODE>
VITE_WALLETCONNECT_PROJECT_ID=<WALLETCONNECT_PROJECT_ID>
VITE_NEYNAR_CLIENT_ID=<EXISTING_NEYNAR_CLIENT_ID>
VITE_X_AUTH_ENABLED=false
```

For the repository's local preview build, put them in
`app/.env.development.local`. That filename is ignored by Git. If Cloudflare
builds the app through Git integration, add the same non-secret variables to
the Pages **Preview** build environment instead.

Important:

- Keep `VITE_TRUSTCONNECT_ENABLED=false` even though the WalletConnect project
  ID is present.
- `VITE_BASE_BUILDER_CODE` must exactly match Base.dev.
- Do not place `APP_SESSION_SECRET` or `BASE_NOTIFICATIONS_API_KEY` in any
  `VITE_*` variable; all `VITE_*` values are public.
- Keep `BASE_NOTIFICATIONS_ENABLED=false` until the notification verification
  phase in `BASE_WEB_APP_SETUP.md` passes.

Build locally with the preview-mode values:

```powershell
pnpm --dir app typecheck
pnpm --dir app test
pnpm --dir app exec vite build --mode development
pnpm --dir app performance:budget
```

Before deploying, inspect the build output for accidental secrets. Search only
for a short, non-sensitive marker from the Builder Code and confirm the two
secret values do not appear.

## 6. Back up and apply migration 0047 to preview

First confirm the binding in [`app/wrangler.toml`](../app/wrangler.toml) still
points at `warplets_preview` and database ID
`4ed108bd-9477-4109-930c-bc57b6c11b1f`.

List migrations without changing the database:

```powershell
pnpm --dir app exec wrangler d1 migrations list warplets_preview --remote --env preview
```

Migrations 0047, 0048 and 0049 may be shown as pending. Do not use `d1 migrations apply`
at this stage: Wrangler applies every pending migration and would therefore run
0048 and 0049 too.

Create a timestamped backup before the first remote migration:

```powershell
$previewBackup = "warplets-preview-before-0047-$((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')).sql"
pnpm --dir app exec wrangler d1 export warplets_preview --remote --env preview --output $previewBackup
Write-Output "Preview backup: $previewBackup"
```

Inspect the command output and confirm it names `warplets_preview`. Then execute
only the 0047 file:

```powershell
pnpm --dir app exec wrangler d1 execute warplets_preview --remote --env preview --file ../migrations/0047_app_identity_and_base_notifications.sql
```

Do not continue if the output names `warplets` or the production database ID.
Migration 0047 uses idempotent `CREATE ... IF NOT EXISTS` statements. Because
this targeted command does not add a row to Wrangler's migration journal, the
later distribution runbook may list and harmlessly execute 0047 once more
before recording it and applying migrations 0048 and 0049.

Verify the new tables:

```powershell
pnpm --dir app exec wrangler d1 execute warplets_preview --remote --env preview --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('app_auth_nonces','app_auth_sessions','app_identity_links','base_notification_status_cache','notification_channel_deliveries','notification_channel_attempts') ORDER BY name;"
```

All six table names must be returned. Do **not** apply migrations 0048 or 0049 yet;
those belong to `DISTRIBUTION_SURFACES_SETUP.md`.

## 7. Deploy and smoke-test preview

Deploy only the preview 10X Warplets project using the repository's established
preview command:

```powershell
pnpm --dir app deploy:dev
```

Verify at `https://warplet-dev.10x.meme`:

1. Anonymous Search, Offers, Listed, Stats, Perks and sharing still load.
2. Farcaster Mini App behavior is unchanged.
3. The web Connect modal shows **Base Account** and the injected-wallet option.
4. TrustConnect and WalletConnect QR are not visible.
5. Connect a Base Sepolia test wallet and complete SIWE.
6. Reload and confirm the HttpOnly application session is restored.
7. Change the wallet account and confirm the authenticated wallet session is
   invalidated immediately.
8. Confirm an unconnected Farcaster profile address is never used as a signer.
9. Submit a low-risk Base Sepolia transaction and confirm the configured
   Builder Code suffix in its calldata.
10. Confirm the Base notification status UI fails closed or reports disabled;
    it must not send while `BASE_NOTIFICATIONS_ENABLED=false`.

If any test fails, leave the flags unchanged and fix preview before continuing.

## 8. TrustConnect proof gate

TrustConnect may be enabled only after this real-wallet matrix passes in
preview:

| Test | Desktop injected | WalletConnect QR | Mobile deep link |
|---|---:|---:|---:|
| Connect and select Base Sepolia | [ ] | [ ] | [ ] |
| Reload and restore session | [ ] | [ ] | [ ] |
| Disconnect cleanly | [ ] | [ ] | [ ] |
| Account-change invalidation | [ ] | [ ] | [ ] |
| SIWE authentication | [ ] | [ ] | [ ] |
| `personal_sign` | [ ] | [ ] | [ ] |
| EIP-712 typed-data signature | [ ] | [ ] | [ ] |
| Ordinary transaction | [ ] | [ ] | [ ] |
| Sequential fallback without EIP-5792 | [ ] | [ ] | [ ] |
| Wallet rejection and return navigation | [ ] | [ ] | [ ] |

Test Trust Wallet plus at least MetaMask and one additional WalletConnect
wallet. Record wallet name/version, browser/device, result and transaction hash.

Until every applicable cell passes, keep:

```dotenv
VITE_TRUSTCONNECT_ENABLED=false
```

Base Account and injected-wallet support can remain enabled independently.

## 9. Exit criteria

This prerequisite is complete only when:

- migration 0047 exists on preview and not as an accidental new production
  change;
- preview sessions, SIWE and account-change invalidation work;
- Base Account and the injected connector work on Base Sepolia;
- Builder Code attribution is visible on the test transaction;
- Base notifications remain disabled;
- TrustConnect remains disabled unless its entire real-wallet matrix passed;
- no secret appears in the Git diff or built client assets.

Then proceed to
[`DISTRIBUTION_SURFACES_SETUP.md`](./DISTRIBUTION_SURFACES_SETUP.md), beginning
with migrations 0048 and 0049 and the new distribution surfaces.
