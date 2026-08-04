# Stats snapshot sharing setup

Stats snapshot sharing has two development modes:

| Mode | Browser | Snapshot PNG storage | Cloudflare resources required |
|---|---|---|---|
| `search-local` (recommended for development) | Browser binding provided by the local Wrangler runtime | Local R2 state | None |
| Cloudflare preview/production | Cloudflare Browser Run | Named Cloudflare R2 bucket | Browser Run binding and R2 bucket |

## Use Stats sharing on `search-local` now

Nothing needs to be created in the Cloudflare dashboard for the normal `search-local` workflow. This path has been tested end to end: the API creates the snapshot, renders the 1200x800 PNG, writes it to local R2, and serves it through `search-local`.

### First-time setup

From the repository root:

```powershell
pnpm install
pnpm --dir app exec wrangler d1 migrations apply WARPLETS --local
```

The migration command creates the `stats_share_snapshots` table in the local D1 database. Re-running it is safe; Wrangler skips migrations that are already applied.

The existing `app/wrangler.toml` already defines both required bindings:

```toml
[browser]
binding = "STATS_SHARE_BROWSER"

[[r2_buckets]]
binding = "STATS_SHARE_IMAGES"
bucket_name = "warplets-stats-shares"
preview_bucket_name = "warplets-stats-shares-preview"
```

In normal local development, the bucket name identifies the binding but does not require that remote bucket to exist. Wrangler keeps the local objects beneath `app/.wrangler/state`.

### Start the stack

```powershell
pnpm --dir app local:tunnel:search
```

This starts:

- Vite on `http://127.0.0.1:5175`
- the Pages Functions/API runtime on `http://127.0.0.1:8790`
- the `search-local` tunnel at `https://search-local.10x.meme`

Open one of these pages:

- `https://search-local.10x.meme/stats`
- `https://search-local.10x.meme/app-testing` for the complete set of mock Share modal launchers
- `https://search-local.10x.meme/stats/share/fixtures/overview` for a render-card fixture

Creating a Stats share should open the Share modal immediately, show its image loading state, and then enable the compose actions when the PNG is ready.

### Direct API smoke test

The UI is the preferred test because it supplies the correct public origin. To test the API directly, include the `search-local` referrer so the browser renderer loads the public tunnel URL instead of trying to navigate back to its own loopback address:

```powershell
$statsShareBody = @{ kind = "overview" } | ConvertTo-Json -Compress

$statsShare = Invoke-RestMethod `
  -Uri "http://127.0.0.1:8790/api/stats/shares" `
  -Method Post `
  -ContentType "application/json" `
  -Headers @{ Referer = "https://search-local.10x.meme/stats" } `
  -Body $statsShareBody

$statsShare | ConvertTo-Json -Depth 5
```

Expected result:

- HTTP `201` when rendering completes in the initial request
- `imageReady: true`
- `shareUrl` and `imageUrl` beginning with `https://search-local.10x.meme/`

A bounded render timeout may instead return a pending response. The Share modal continues polling and exposes Retry if rendering ultimately fails.

## What local mode does and does not provide

Local snapshots are ideal for UI and rendering tests, but they are not durable public assets:

- The local D1 and R2 data belongs to this development machine.
- Other machines do not share the snapshot store.
- Removing `app/.wrangler/state` removes the local snapshot database and images.
- Share URLs only work while the local API and `search-local` tunnel are running.
- Do not publish a permanent Farcaster cast or X post that relies on a `search-local` snapshot URL.

## Optional: prepare Cloudflare resources now

You can create the two named buckets before deployment. This is not required for `search-local`, and creating them does not deploy the app.

Authenticate Wrangler with the Cloudflare account that owns the app:

```powershell
pnpm --dir app exec wrangler login
pnpm --dir app exec wrangler whoami
```

Create and verify the buckets already named in `app/wrangler.toml`:

```powershell
pnpm --dir app exec wrangler r2 bucket create warplets-stats-shares-preview
pnpm --dir app exec wrangler r2 bucket create warplets-stats-shares
pnpm --dir app exec wrangler r2 bucket list
```

The buckets should remain private. Snapshot PNGs are served by the app's image route, which applies immutable cache headers; a public `r2.dev` domain is not needed.

Browser Run does not require creating a named resource. The `[browser]` binding in `app/wrangler.toml` is what makes `env.STATS_SHARE_BROWSER` available after deployment. Browser Run is available on Workers Free and Paid plans, subject to the limits of the account's plan.

Before the first preview or production deployment:

1. Confirm both bucket names exist in the same Cloudflare account used by Pages.
2. Confirm the Pages deployment uses `app/wrangler.toml` and Wrangler `4.118.0` or later.
3. Apply migration `0046_stats_share_snapshots.sql` to preview first:

   ```powershell
   pnpm --dir app exec wrangler d1 migrations apply WARPLETS --remote --env preview
   ```

   Apply it to production only as part of the later production release:

   ```powershell
   pnpm --dir app exec wrangler d1 migrations apply WARPLETS --remote
   ```

4. Deploy the preview environment first and create all Stats card families there.
5. Check Browser Run usage in the Cloudflare dashboard and verify the generated PNG objects appear in the preview R2 bucket.
6. Only then enable the production workflow.

Do not add `remote = true` to the current top-level bindings merely to test `search-local`. That would cause local requests to write to real Cloudflare storage and incur live Browser Run/R2 usage. If remote-binding testing is needed, add a dedicated, explicitly selected development configuration that points only to `warplets-stats-shares-preview`; never point local development at the production bucket.

## Troubleshooting

### The snapshot table is missing

Run:

```powershell
pnpm --dir app exec wrangler d1 migrations apply WARPLETS --local
```

Then restart `local:tunnel:search`.

### The API reports that a binding is missing

Confirm `STATS_SHARE_BROWSER` and `STATS_SHARE_IMAGES` remain in `app/wrangler.toml`, run `pnpm install`, and restart the complete local stack. Do not start only Vite; snapshot creation needs the Pages Functions runtime on port `8790`.

### Rendering times out waiting for the ready marker

- Confirm `https://search-local.10x.meme/stats/share/fixtures/overview` loads.
- Confirm the tunnel still points to Vite on port `5175`.
- Use the UI, or send the `Referer: https://search-local.10x.meme/stats` header in a direct API test.
- Check the API terminal for image/font fallback warnings.

### Ports are already in use

Stop the old `search-local` stack before restarting it. The expected ports are `5175` for Vite and `8790` for the API runtime.

### Browser Run returns a quota error after deployment

Review Browser Run usage and limits in the Cloudflare dashboard. The renderer closes browser sessions in a `finally` block, but every newly generated content hash still requires browser time. Already-rendered snapshots reuse the immutable PNG stored in R2.

## Cloudflare references

- [Browser Run Wrangler bindings](https://developers.cloudflare.com/browser-run/reference/wrangler/)
- [Local development and remote bindings](https://developers.cloudflare.com/workers/local-development/)
- [R2 bindings in Workers](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Create and list R2 buckets](https://developers.cloudflare.com/r2/buckets/create-buckets/)
- [Browser Run limits](https://developers.cloudflare.com/browser-run/limits/)
