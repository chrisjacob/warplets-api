# Thesis-only production release

22 October 2026 (Australia/Sydney). Founder request: prepare the next production release while retaining the old thesis at the root and keeping the unfinished 10X product inaccessible. This implementation prepares the release; it does not authorize or perform deployment.

## Public behaviour

- `app.10x.meme/` renders the existing thesis video, email signup and community links. `/thesis` remains available. The root never lands on the empty home panel while the product flag is closed.
- Signed-in and signed-out account menus omit Discover and Solana sign-in/wallets. The thesis menu item points home. Existing public menu, legal pages, account connections, notifications, email preferences, Warplets and Stonklets remain available.
- Direct GET/HEAD requests to unfinished product namespaces redirect temporarily to the same-origin root, dropping the query. They include discovery/token details, attention/campaigns/submission, wallets, research, elections, backing/rewards, labs/recovery, status/transparency and `/admin/10x`. Namespace matching also covers malformed/deeper routes and encoded route names, rather than only valid current page patterns.
- `/api/10x` and descendants return 404 for every method while closed. Page mutation attempts also return 404. The middleware stops before downstream handlers or storage/provider IO. Cookies, query parameters and browser flags cannot opt a visitor in. Redirects and rejections are `no-store` and `noindex`.
- The gate covers shared Pages hosts, including the `pages.dev` hostname. It does not depend on the request being addressed to the main custom domain. The separate `web/` site serving `10x.meme` is unchanged.

## Flag and release configuration

| Layer | Setting | Closed production release | Local development |
|---|---|---|---|
| Browser build | `VITE_TENX_APP_ENABLED` | Explicit `false` in `app/.env.production`; absent values also stay closed outside the Vite development server | Enabled by default in the Vite development server; set `false` to rehearse the closed UI |
| Pages middleware | `TENX_APP_ENABLED` | Explicit `"false"` in both production and preview `app/wrangler.toml` vars; only exact `"true"` opens requests | Vite's existing isolated `/api/10x` proxy continues to reach the local-only Discovery Worker |

These are the build-time UI and server-side halves of one exposure feature. Changing a server variable cannot restore code omitted from a closed browser build. A future public opening requires an intentional enabled build, explicit server opt-in and replacement of the thesis-only release assertion with the approved public-release checks. An enabled build alone must not be shipped during this release.

The closed build removes the dynamic Discovery import, so discovery/research/content/lab chunks are absent from the production manifest and assets. This also avoids shipping an unfinished interface that could be mounted manually. `pnpm --dir app release:check` verifies the actual built artifact retains the thesis and excludes those chunks, and verifies the production server setting is closed. Existing production deploy scripts (including the fast path) and the Pages CI job run it before upload. The check intentionally rejects an enabled or stale hidden-product build. Direct manual Wrangler upload commands remain outside those wrappers; use the checked release path.

## Data and action boundaries

Migrations may be included in the eventual production release without opening any surface. No migration or database operation is added or run here. This flag does not activate or publish the local-only Discovery Worker, change collection schedules, restore/disable provider limits, adopt a scoring model, or enable signing, elections, votes, rewards or launches. Local calibration mode still requires its existing production restoration checks before any future Discovery service release. All source/evidence/action gates remain unchanged.

## Release verification

Run the targeted release-gate/navigation tests, the release-checker negative fixtures, application typecheck/build/performance budget, the closed-artifact assertion and Pages Functions compilation. Verify root/thesis content, public menu and existing products; verify direct hidden page links recover home and `/api/10x` fails without forwarding. The middleware tests cover GET/HEAD and mutation methods, absent/false versus explicit enable, alternate shared hosts and query overrides. Test local discovery separately with its ordinary development default.

Before the eventual authorized release, keep both production settings closed and run `pnpm --dir app release:check` against the exact artifact to be uploaded. Do not publish the local Discovery service or its calibration configuration. After the release, smoke-test the public root, direct hidden page redirects, API rejection, email signup and existing products. No deployment or production mutation was performed while preparing this change.

Preparation results: the 24 focused release/navigation tests, all 118 existing discovery UI tests and three artifact-checker fixtures passed, as did the final application typecheck, production build/performance budget and actual artifact assertion. Pages Functions compiled successfully. An isolated emulator exercised the compiled middleware on twelve hidden requests across the custom domain, `pages.dev` and a sibling product host: page redirects/API rejection reached no asset handler, while the public root returned 200. The browser rendered the thesis/video/signup/community links at the root, omitted unfinished account-menu entries and rendered the thesis fallback at a direct discovery URL. The emulator used fake assets without database or external-service bindings; no signup, account connection, provider collection or production request mutation was submitted.
