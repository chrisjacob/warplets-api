# 10X Warplets hostname and identity setup

The application code now uses these canonical identities:

| Environment | Public origin | Application slug |
|---|---|---|
| Local tunnel | `https://warplet-local.10x.meme` | `warplets` |
| Preview | `https://warplet-dev.10x.meme` | `warplets` |
| Production | `https://warplet.10x.meme` | `warplets` |

The Search feature and `/search` bot commands keep their existing names. The
whole application, webhook audience and notification scope use `warplets`.

No old Search hostname is retained or redirected because the app was not live
before this change.

## 1. Create the local named tunnel

Install and authenticate `cloudflared`, then run:

```powershell
cloudflared tunnel login
cloudflared tunnel create warplet-local
cloudflared tunnel route dns warplet-local warplet-local.10x.meme
cloudflared tunnel info warplet-local
```

The create command prints the tunnel UUID and writes its credential file. On
Windows the normal location is:

```text
%USERPROFILE%\.cloudflared\<TUNNEL-UUID>.json
```

The account certificate normally lives beside it as `cert.pem`. Do not commit
either file. On the machine that created the tunnel, the repository launcher
can resolve the `warplet-local` name using the existing Cloudflare credentials.

For another development machine:

1. Install `cloudflared`.
2. Securely copy the tunnel credential JSON to that machine; do not publish it
   or put it in the repository.
3. Set the tunnel UUID and absolute credential path before starting the app:

   ```powershell
   $env:WARPLETS_TUNNEL_ID = '<TUNNEL-UUID>'
   $env:WARPLETS_TUNNEL_CREDENTIALS_FILE = '<ABSOLUTE-PATH-TO-TUNNEL-UUID.json>'
   pnpm --dir app local:tunnel:warplet
   ```

   Supplying the UUID is important: `cloudflared` can run a tunnel by UUID with
   only the tunnel-specific JSON and does not need the account-wide `cert.pem`.

4. Confirm the launcher reports four connected tunnel sessions and verify
   `https://warplet-local.10x.meme` from a separate browser or device.

Do not share `cert.pem`; it grants broader account-level tunnel management than
the tunnel-specific JSON credential.

## 2. Generate exact-domain Farcaster associations

Farcaster account associations are signed for one exact hostname. Generate a
separate association for each hostname you will use:

- `warplet-local.10x.meme`
- `warplet-dev.10x.meme`
- `warplet.10x.meme`

Store the complete JSON object containing `header`, `payload` and `signature` as
`WARPLETS_ACCOUNT_ASSOCIATION_JSON` in the matching environment. The app
decodes the payload and returns `503` instead of publishing a manifest signed
for a different hostname.

For the current PowerShell session and local tunnel:

```powershell
$env:WARPLETS_ACCOUNT_ASSOCIATION_JSON = '<JSON SIGNED FOR warplet-local.10x.meme>'
pnpm --dir app local:tunnel:warplet
```

Verify:

```powershell
Invoke-RestMethod https://warplet-local.10x.meme/.well-known/farcaster.json |
  ConvertTo-Json -Depth 8
```

Confirm that:

- `accountAssociation.payload` decodes to `warplet-local.10x.meme`;
- `miniapp.name` is `10X Warplets`;
- `miniapp.canonicalDomain` is `warplet-local.10x.meme`;
- `miniapp.homeUrl` uses the same origin;
- `miniapp.webhookUrl` ends in `/webhook/warplets` on the same origin.

For Pages preview and production, add the matching JSON as an encrypted
`WARPLETS_ACCOUNT_ASSOCIATION_JSON` variable in each environment. Never reuse
one environment's association in another.

## 3. Test the local identity migration

The launcher uses local D1 state. Apply pending migrations before testing:

```powershell
pnpm --dir app exec wrangler d1 migrations apply WARPLETS --local
```

Migration `0049_warplets_app_identity.sql` changes application identity rows and
schema defaults from `search` to `warplets`. It does not rename genuine search
queries, Search UI state or marketplace data provenance.

Start the complete stack:

```powershell
pnpm --dir app local:tunnel:warplet
```

Check the dedicated host at `/` and the umbrella app route at `/warplets`.
Also test Quick Auth, SIWE, Favourites, Friends, Stats shares, Offers, Listed,
notifications, the PWA manifest and 10X Tabs navigation.

## 4. Attach preview and production domains

In Cloudflare **Workers & Pages**:

1. Open the preview Pages project and add `warplet-dev.10x.meme` as a custom
   domain.
2. Open the production Pages project and add `warplet.10x.meme` as a custom
   domain.
3. Wait for both the DNS status and TLS certificate status to become active.
4. Configure the exact-domain association and environment variables before
   opening either host in Farcaster.
5. Apply migrations 0047 through 0049 to preview first, after exporting a D1
   backup. Apply them to production only as part of the production release.

Do not remove old DNS records or tunnel credentials until the new local and
preview hosts have passed the verification checklist. Since the old app was not
live, remove them afterward without redirects.

## 5. Update external registrations

Use the exact new origins in external dashboards and callback allowlists:

- Base.dev app URL and Base notification app URL:
  `https://warplet.10x.meme`
- WalletConnect/TrustConnect origins: all three Warplets origins plus the exact
  localhost origin used for direct Vite testing
- X OAuth callbacks:
  `https://<WARPLETS-HOST>/api/auth/x/callback`
- Telegram OIDC callbacks:
  `https://<WARPLETS-HOST>/api/auth/telegram/callback`
- Discord OAuth callbacks:
  `https://<WARPLETS-HOST>/api/auth/discord/callback`
- Bot and Agent API variable:
  `WARPLETS_APP_ORIGIN=https://warplet.10x.meme` (or the matching preview URL)

Keep the existing Builder Code, GA4 property and VAPID keys. Existing sessions,
push subscriptions and PWA installs tied to old hosts are intentionally not
migrated.

## 6. Final removal checklist

Only after the new host is verified:

```powershell
cloudflared tunnel list
cloudflared tunnel info warplet-local
```

Then remove the unused old custom domains and DNS records in Cloudflare. If an
old local tunnel exists, first resolve its exact UUID with `cloudflared tunnel
list`; deleting it is a separate destructive operation and is intentionally not
performed by repository scripts.

No deployment or Cloudflare resource creation is performed by the code change.
# Farcaster Mini App launch URL

Until the dedicated 10X Warplets Mini App is published, the web Connect modal
uses the existing 10X Mini App as its "Open in Farcaster" destination. Once the
Warplets Mini App is live, configure this public build variable for preview and
production using its exact Farcaster Mini App URL:

```text
VITE_FARCASTER_WARPLETS_MINI_APP_URL=https://farcaster.xyz/miniapps/<warplets-id>/<warplets-slug>
```
