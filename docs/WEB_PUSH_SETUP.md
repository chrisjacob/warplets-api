# 10X Web Push Setup and Production Runbook

This runbook covers Web Push for `app-local.10x.meme` / `10x.meme`, Search, and
the shared Cloudflare Pages production project `10x-app`. One stable production
VAPID pair is intentionally shared by the two production origins; D1
`app_slug` values keep their recipient sets separate.

Web Push requires one P-256 VAPID key pair:

- `VAPID_PUBLIC_KEY`: sent to browsers when they create a subscription.
- `VAPID_PRIVATE_KEY`: used only by the Pages Function when encrypting and
  signing a push request.
- `VAPID_SUBJECT`: operator contact, currently
  `mailto:notifications@10x.meme`.

Use different key pairs for local development and production. Keep each key
pair stable. Replacing a public/private pair invalidates subscriptions made
with the previous public key, so users would need to enable notifications
again.

## Local setup: `app-local.10x.meme`

### 1. Stop the existing tunnel

If the app tunnel is already running, press `Ctrl+C`. The VAPID values are read
when the local Pages Worker starts.

### 2. Generate a local-only key pair

From the repository root in PowerShell:

```powershell
pnpm --dir app web-push:generate-keys -- app
```

The script prints three `$env:` assignments followed by the app tunnel command.
Copy and run those four generated lines in the same PowerShell window. Do not
share or commit the generated private key.

To retain the same development pair across terminal restarts, store the three
values in `app/.dev.vars` instead:

```dotenv
VAPID_PUBLIC_KEY="generated-local-public-key"
VAPID_PRIVATE_KEY="generated-local-private-key"
VAPID_SUBJECT="mailto:notifications@10x.meme"
```

`app/.dev.vars` is gitignored. Use either `.dev.vars` or the PowerShell
environment assignments, not two different key pairs.

### 3. Start the app tunnel

```powershell
pnpm --dir app local:tunnel:app
```

The launcher applies pending migrations to the local D1 database before it
starts Vite, the Pages Function runtime and the Cloudflare tunnel. Migration
`0060_web_push_app_scope.sql` adds `app_slug` to existing Web Push
subscriptions and defaults existing rows to `warplets`.

### 4. Verify local configuration

```powershell
Invoke-RestMethod https://app-local.10x.meme/api/web-push/public-key
```

Expected: HTTP `200` and a JSON object containing `publicKey`. A `503` response
means the VAPID values were not available when the Pages Worker started.

Confirm the local schema:

```powershell
pnpm --dir app exec wrangler d1 execute warplets --local --command "PRAGMA table_info(web_push_subscriptions)"
```

The result must include an `app_slug` column.

### 5. Create and inspect a local subscription

1. Open `https://app-local.10x.meme/` in Chrome.
2. Connect a wallet or Farcaster identity so the profile avatar is visible.
3. Open the profile menu and select **Enable notifications**.
4. Confirm the `FOMO? Don't Miss Out...` modal.
5. Allow browser notifications.

Inspect only the safe subscription metadata:

```powershell
pnpm --dir app exec wrangler d1 execute warplets --local --command "SELECT endpoint_hash, app_slug, enabled, topics_json, farcaster_fid, wallet_address, created_at FROM web_push_subscriptions ORDER BY created_at DESC LIMIT 10"
```

The new row should have `app_slug = 'app'`, `enabled = 1`, and an
`announcements` topic. If Chrome previously blocked notifications, use the
site-information icon beside the address, reset the Notifications permission,
reload, and try again.

For Search testing, reuse the same development pair in the current PowerShell
window and run:

```powershell
pnpm --dir app local:tunnel:warplet
```

Search subscriptions should have `app_slug = 'warplets'`. If Search is run in a
different terminal, load the same three local values there first. Generate a
separate `warplet` pair only when intentionally testing Search in isolation;
changing the local pair requires local browser subscriptions to be recreated.

## Production setup: `10x.meme`

Do these steps once, immediately before the first production deployment that
contains Web Push. Commands are run from the repository root in PowerShell.

### 1. Confirm Cloudflare authentication and pending migrations

```powershell
pnpm --dir app exec wrangler whoami
pnpm --dir app exec wrangler d1 migrations list warplets --remote
```

As of 23 August 2026, the only pending production migration is:

```text
0060_web_push_app_scope.sql
```

Stop and review the migration list if additional files appear. Wrangler applies
all pending migrations in order.

### 2. Generate the production VAPID pair once

```powershell
pnpm --dir app web-push:generate-keys -- production
```

Immediately store all three printed values in the project password manager.
Treat the private key as a production credential. Do not place it in source
control, a ticket, chat, shell command, or deployment log.

### 3. Add the three encrypted Pages secrets

Run each command separately. Wrangler prompts securely for the corresponding
value; paste only at the prompt:

```powershell
pnpm --dir app exec wrangler pages secret put VAPID_PUBLIC_KEY --project-name 10x-app
pnpm --dir app exec wrangler pages secret put VAPID_PRIVATE_KEY --project-name 10x-app
pnpm --dir app exec wrangler pages secret put VAPID_SUBJECT --project-name 10x-app
```

Use `mailto:notifications@10x.meme` for `VAPID_SUBJECT`.

All three are stored as encrypted secrets. The public key and subject do not
need secrecy, but storing them this way prevents a later Wrangler deployment
from overwriting dashboard plaintext variables that are absent from
`app/wrangler.toml`.

Verify names only (secret values are never returned):

```powershell
pnpm --dir app exec wrangler pages secret list --project-name 10x-app
```

The list must include all three VAPID names. Secrets must be configured before
the production Pages deployment that consumes them. As of 23 August 2026, the
production project does not yet contain any of the three VAPID names.

### 4. Record a D1 recovery bookmark and apply the migration

```powershell
pnpm --dir app exec wrangler d1 time-travel info warplets
pnpm --dir app exec wrangler d1 migrations apply warplets --remote
```

Save the pre-migration Time Travel bookmark/output with the release notes. The
migration is additive: it keeps existing subscriptions and classifies them as
`warplets`, then creates an index for app-scoped delivery.

Verify the migration:

```powershell
pnpm --dir app exec wrangler d1 migrations list warplets --remote
pnpm --dir app exec wrangler d1 execute warplets --remote --command "PRAGMA table_info(web_push_subscriptions)"
```

There should be no pending migration and the table must include `app_slug`.

### 5. Build and deploy the Pages project

Run the standard checks and production deployment:

```powershell
pnpm --dir app typecheck
pnpm --dir app test
pnpm --dir app build
pnpm --dir app deploy:prod
```

The deployment is required after setting Pages secrets so the deployment uses
the updated production configuration.

### 6. Verify production before inviting users

Check the public configuration and PWA manifest:

```powershell
Invoke-RestMethod https://10x.meme/api/web-push/public-key
Invoke-RestMethod https://10x.meme/manifest-10x.webmanifest
```

Expected:

- the public-key endpoint returns HTTP `200` and `publicKey`;
- the manifest name and short name are `10X.MEME`;
- no endpoint exposes `VAPID_PRIVATE_KEY`.

Then create one real subscription from a browser you control. Connect your
Farcaster identity first if you want to target the test by FID.

Verify the production row:

```powershell
pnpm --dir app exec wrangler d1 execute warplets --remote --command "SELECT app_slug, enabled, topics_json, farcaster_fid, wallet_address, created_at FROM web_push_subscriptions WHERE app_slug = 'app' ORDER BY created_at DESC LIMIT 10"
```

### 7. Send a controlled notification

Open `https://app.10x.meme/__adminhidden/` and use the notification sender:

1. Select the **App** audience.
2. Select **Web Push** only.
3. If the subscription is linked to Farcaster, use the FID-only mode with your
   own FID. Otherwise ensure yours is the only `app` subscription before using
   an all-recipient test.
4. Use a unique campaign/notification ID.
5. Set the target URL to a `https://10x.meme/` page.
6. Send and confirm that clicking the notification focuses or opens 10X.MEME.

Inspect delivery without exposing subscription endpoints:

```powershell
pnpm --dir app exec wrangler d1 execute warplets --remote --command "SELECT campaign_id, app_slug, channel, status, attempts, last_error, opened_at, updated_at FROM notification_channel_deliveries WHERE channel = 'web-push' ORDER BY updated_at DESC LIMIT 20"
```

## Troubleshooting

- **`/api/web-push/public-key` returns `503`:** one or more VAPID secrets is
  missing, or the project was not redeployed after the secrets were configured.
- **Permission is denied immediately:** notifications are blocked in the
  browser/site settings. Reset the site permission before retrying.
- **Subscription has the wrong `app_slug`:** verify the browser is on
  `10x.meme`/`app-local.10x.meme`, clear the old service worker if necessary,
  reload, and subscribe again.
- **Delivery returns `404` or `410`:** the push endpoint is stale. The sender
  disables it automatically; the user must enable notifications again.
- **All deliveries fail after changing keys:** the public/private VAPID pair no
  longer matches the pair used to create the subscriptions. Restore the saved
  production pair or have users resubscribe.
- **No install prompt appears:** the browser may not support a programmatic PWA
  prompt, the app may already be installed, or the page may be in an embedded
  browser. The profile action falls back to browser-specific install guidance.

## Rollback and key management

- Do not rotate the production VAPID pair during a normal code rollback.
- A code rollback does not require removing `app_slug`; the migration is
  backward-compatible and should remain applied.
- To pause Web Push without changing subscriptions, omit the Web Push channel
  in the notification admin sender.
- Use the saved D1 Time Travel bookmark only for a genuine database incident;
  restoring D1 rewinds unrelated production writes as well.
- Never delete or replace `VAPID_PRIVATE_KEY` unless intentionally rotating the
  pair and accepting that existing browser subscriptions must be recreated.
