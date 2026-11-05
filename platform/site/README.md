# 10X browser client

This standalone React 19 / TypeScript application reads the versioned 10X API through its generated client. TanStack Router owns the five public routes and their shareable search parameters, TanStack Query manages remote state, and Vite with Tailwind v4 builds same-origin static assets. Native dialogs and form controls keep keyboard behavior in the platform. Wallet Standard discovery and an injected Solana fallback support message signing for local authentication.

From this directory:

    pnpm install --frozen-lockfile --ignore-scripts
    pnpm test
    pnpm build

These commands build local files under `dist/`. The host can compose `serveSite(request)` before its reference HTML handler. It returns null when a public route has no compiled build. Use the same local origin for signing challenges, submitting contributions and collection operations. The preview uses fixture data and has no production deploy script.

The development server binds to loopback by default. For an authenticated walkthrough use a compiled build with the API on the same origin. Package versions are pinned in the isolated lockfile to avoid changing the legacy applications.

Canonical public routes include `/markets/{id}`, `/collections/genesis`, `/seasons/{id}`, `/nfts/{id}` and `/earn/{UTC-date}`. The optional anonymous reader passed to `serveSite` generates meaningful initial HTML and share metadata. Private dashboards make no anonymous account reads. The local preview sends noindex headers. Query-based market and Earn links continue to work.

The wallet panel supports explicit local-inbox consent and revocation, plus retrieval of private transaction rehearsal receipts. Public pages offer browser sharing or copy-link only on the user's click. These actions are exercised against disposable local keys and records.

The quote panel appears on market details only when current local pool evidence is available. It uses the generated quote operation, displays both input directions, OG trading fee, minimum output, slippage, price impact and effective buy FDV. The backend controls all economic quantities and expiry. Browser unit formatting preserves exact decimal strings. The preview presents no trade submission action.

Optional browser checks use an installed Chromium and Playwright, without downloading a browser:

    PLAYWRIGHT_MODULE=/local/path/to/playwright BROWSER_EXE=/local/path/to/chromium node tests/browser-qa.mjs

The suite checks 360, 390, 768 and 1440 pixel routes, canonical HTML, both wallet adapters, local consent, public and private collection journeys, and exact-input quote presentation. Use `--only-quotes` to run the quote interaction alone. A physical mobile wallet/deep-link test remains a separate release requirement.
