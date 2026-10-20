# Local performance review — 21 October 2026

The review found three useful improvements: reduce Discover's evidence payload, defer wallet connection/trading modules, and preserve the loaded app during internal discovery navigation. These are implemented locally. No discovery gate, provider allowance, reward policy, stored evidence or signing authority changes.

## Measured results and limits

| Measurement | Before | After | Result |
|---|---:|---:|---|
| 100-token Discover JSON body | 439,343 bytes (full view) | 69,348 bytes (cards view) | 84.2% smaller, compared on the same local run |
| Home shell statically reachable JavaScript, uncompressed | 840,699 bytes | 742,283 bytes | 98,416 fewer bytes |
| Home shell statically reachable JavaScript, sum of individually gzipped chunks | 264,722 bytes | 239,532 bytes | 9.5% smaller |
| Internal discovery navigation | Full document navigation and app bootstrap | Existing React router/history, retained shell | Discover → Backing and browser Back/Forward verified through the tunnel |

Bundle figures come from Vite's emitted manifest, recursively following static imports from `src/App.tsx`, counting each JS file once. Dynamic imports, CSS, fonts, images/video and response headers are excluded. They describe dependency cost, not measured browser transfer size or paint timing. The standalone Discovery component graph grew slightly (247,606 → 248,714 gzip bytes) from the card contract and navigation helper; the shell's deferred connection graph provides the net reduction. This is a build measurement for the shared shell, while discovery routes remain development-only.

The read-only API benchmark takes four sequential local samples per endpoint and reports the median of the last three. Final warm medians were 172 ms for the full list, 144 ms for cards, 91 ms for backing and 117 ms for coverage. Background collectors, builds and changing source data make these small samples noisy; no general latency percentage is claimed. Backing already returns about 16 KB and did not justify adding a potentially stale evidence cache. The larger list transfer and full-document navigation were higher priorities.

Chrome DevTools tracing was unavailable in this session. LCP, INP, CLS, CPU profiles, cold-cache tunnel transfer and field performance were **not measured**. No Lighthouse or Core Web Vitals score is claimed. Retained local benchmark artifacts are `.tmp/tenx-performance-before.json` and `.tmp/tenx-performance-after.json`.

## Implementation

`GET /api/10x/candidates?view=cards` applies the same full candidate parsing, current-time assessment, ranking, filtering and snapshot hashing before projecting presentation fields. The compact contract retains identity, artwork URL, market values/timestamps, creation time, holder summary, chain-verification status, eligibility and **all** reason codes. It omits raw owner inventories, wallet histories, funding graphs, risk inputs and transaction proofs. These remain in the default `view=full` response and token detail/evidence APIs. A card is not a candidate input and cannot be reassessed as one. The high-cap diagnostic accepts only the market/creation fields it actually uses; its rule is unchanged.

Discover requests cards for its existing maximum of 100 displayed contenders. Public Zod contracts and OpenAPI document both views. Cursors bind the presentation view as well as the original full snapshot, filters and age window. Older full-view cursors without a view field retain full-view semantics; crossing views fails with 409. No result cache or freshness extension was introduced.

The home shell now loads `WebConnectModal` only when opened, with a local loading/cancel affordance. `appSession` loads signing/encoding modules during wallet authentication, and `walletController` loads trading/chain helpers when called. Session reads and ordinary browsing no longer statically import that code. Existing server challenges, exact UTF-8 signature encoding, network/account checks and rejection handling remain in place. This follows [React's documented lazy-loading behavior](https://react.dev/reference/react/lazy). The dialog opened and closed successfully during browser verification; no wallet was connected or signed.

Links inside discovery use the existing root router and history notification instead of reloading the document. Navigation is restricted to same-origin discovery routes. Modified clicks, new tabs, downloads, outside apps, API evidence links and hash-based evidence navigation retain browser behavior. Queries such as `mode=fixture` are preserved. Keyboard focus moves to the retained main region, and new page clicks scroll to the top. The existing embedded-browser history helper preserves its replace-state behavior; normal browser Back/Forward remain available. The shared route predicate retains the existing development-only gate in the root router.

Vite now emits a build manifest. The performance budget checks the entire static home-shell JS graph at **250 KiB gzip**, in addition to the existing per-file caps. It also fails if connection-dialog or trading chunks become statically reachable again. The current graph is 233.9 KiB gzip. The manifest is build metadata; no provider, database, secret or runtime configuration was added. No migration is needed. Build inspection follows the [Vite build documentation](https://vite.dev/guide/build.html).

## Validation and remaining work

- All **299 discovery tests across 30 files** pass, including full/card eligibility, reason, order and count parity; response-size reduction; detail evidence retention; and cursor-view isolation.
- **37 focused app tests across seven files** pass: navigation, history, wallet authentication/identity, signature/error handling and the app shell. Final navigation/history tests pass again after integration with the embedded-browser helper.
- App and discovery typechecks, app build, aggregate/per-file performance budgets, OpenAPI generation and diff whitespace checks pass.
- Existing V3 backing replay and two legacy backing replays verify from retained inputs; three discovery rehearsal replays also verify. Checks make zero provider requests.
- Browser checks show rendered cards, warnings, holder summaries and eligibility; deferred connection options; retained-shell Discover/Backing navigation; and browser Back/Forward. Artwork URLs remain in the compact contract. Preview evidence is `.tmp/performance-backing-preview.png`.

The local timer remains recent and the watchdog fresh. The operations check reports an upstream wallet source issue (`wallets_source_issue`); no quota reset, forced retry or evidence relaxation was used to hide that gap. Provider health and reaching ten eligible tokens remain separate unresolved work. A transient truncated JSON response during development reload recovered on the existing backing poll; the retained API/replays subsequently verified.

Lower-priority follow-up: collect a real browser trace once tracing tools are available, then target measured route-specific schema/UI costs or repeated database reads. Large shared UI chunks and decorative video are still present; their actual paint/main-thread impact has not been established here. No paid service or remote deployment was used.

Commands (repository root, local only):

```powershell
pnpm --dir app build
node scripts/measure-tenx-performance.mjs .tmp/tenx-performance-after.json
pnpm --dir discovery typecheck
pnpm --dir discovery test
pnpm --dir app test -- src/discovery/navigation.test.ts src/spaHistory.test.ts src/appSession.test.ts src/appSession.identity.test.ts src/walletTrade.identity.test.ts src/walletTrade.walletConnectError.test.ts src/MiniAppShell.test.ts
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-backing-local.ts
pnpm exec tsx scripts/check-discovery-operations.ts
git diff --check
```
