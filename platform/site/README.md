# 10X browser client

## Brand and launch presentation

[The 24 November decision](../spec/BRAND_ALIGNMENT_DECISION_2026-11-24.md) governs current names and launch hierarchy. Shared typed presentation lives in `public-content.mjs` / `public-content.d.mts`. It does not control financial actions. `src/brand.tsx` composes the first $10X meme, Season 0 plan, FAQ and roadmap; `brand-art.tsx` provides provisional typographic studies.

Home, Tokens, Collect and Earn are the primary navigation. Collect reuses `/nfts`; Rewards is a wallet-adjacent utility at `/airdrops`. Attention and Earn share one participation screen. Stake and rankings remain contextual links; all legacy paths and query links still work. No new $10X API market is fabricated. Season 0 pricing is informational; local test stages retain their recorded SOL prices. Actual token tickers are preserved even with the optional reference-image overlay.

Per the owner’s 24 November consumer review, the private app-local interface omits local/test/demo disclaimers, including the shell, snapshots and exported reward card. Internal data provenance and execution controls remain intact. Legacy Base Warplet art and provenance remain archived, not presented as the permanent collection. The old social PNG is withheld from metadata pending an approved replacement; the existing generic favicon is retained.

Validation: `pnpm test`, `pnpm build`, and the existing `tests/browser-qa.mjs` with an installed browser. `tests/brand-alignment.spec.mjs` covers identity preservation, missing dates, explicit timezones and concealed artwork. No lint or format script is configured in this package; use TypeScript, tests, build and `git diff --check`.

This standalone React 19 / TypeScript application reads the versioned 10X API through its generated client. TanStack Router owns the Home, Tokens, NFTs, Airdrops, Attention and Leaderboard destinations, with retained Stake and Earn routes and their shareable search parameters, TanStack Query manages remote state, and Vite with Tailwind v4 builds same-origin static assets. Native dialogs and form controls keep keyboard behavior in the platform. Wallet Standard discovery and an injected Solana fallback support message signing for local authentication.

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

Runtime support comes from the validated `/api/v1/capabilities` method/path inventory. Unsupported and failed-discovery reads remain disabled and show an unavailable state; policy stays readable. Quote, recovery, inbox and action components mount only when their routes are advertised. Private data keys include the authenticated wallet and Solana chain, including stage eligibility. Session loss cancels and removes those queries. Wallet account/disconnect events cancel pending sign-in reviews and disclose a changed extension account without relabelling the authenticated session. Focus and page-return events refresh the original session and receipts.

The browser suite also supplies a recorded Worker capability profile at all four widths, proving unsupported API requests never leave the client. This is client-profile evidence, not D1/Worker end-to-end evidence. Wallet Standard fixtures cover account change during review, disconnect after authentication, rejected/tampered signatures, unregister, cancellation/focus, session expiry and private receipt removal. The harness uses disposable keys; no physical wallet or transaction signing is exercised. Set `SCREENSHOT_DIR` to retain all four widths.

B10 member disclosures use additive Node fixture projections. Collection counts describe priced-stage, free-stage and founder-stage allocations, never verified sales. Published terms digests and fixed free-stage opening cuts are displayed. Unknown eligibility stays unknown; reveal counts include only approved public metadata. Season expiry dates and remaining milliseconds are produced by the server from the original Season start. Later launch prices and Sydney launch hours remain unset.

Material selection traverses at most four owned-asset pages (100 assets), filters distinct same-owner/Season/Level revealed assets, and requires a listed choice. The server rechecks versions and provides probabilities/expiry; a stale quote holds confirmation. Reroll state, owner evidence timestamps and historical-claim continuity are disclosed. The browser suite tests a matching material on page two, arbitrary-ID rejection, keyboard review and stale-pair holds at all four widths.

Vault combined totals are produced in one bounded server transaction, across the complete local fixture ledger (100 assets/100 manifests). Any concealed tracked asset or exceeded bound makes the whole summary unavailable. Token base units stay separate by campaign; fiat prices remain unavailable. Original activation, cliff and vesting dates survive transfer and progression. This completeness is local ledger completeness, not a claim of chain coverage.

The optional owner-only Earn memberStatus projection separates current admission evidence, accepted submissions, pending cutoff evidence and sealed components. Action completion needs recorded verifier evidence. The shared domain computes overall multipliers; the UI only formats tenths. Missing ownership/purchase/history evidence is never shown as a zero-valued multiplier. Worker routes continue to follow their capability inventory.

Offline operator whitelist preparation is available through `node platform/collect/operator.mjs whitelist-dry-run fixture.json` from the repository root. Input is `{source,entries}` with at most 10,000 canonical Solana addresses. Output includes sorted unique wallets, counts, indexed errors and a fixture-source digest; it performs no database writes. Review the report and use its accepted wallets in the existing immutable `stage` publication packet. This is not live chain eligibility or approval to publish a real priced stage.

## Populated performance review

The optional local performance source supplies top-100 category boards inside expandable sections, defaulting to Market with a Peak toggle. Home omits ranking previews. Boards display ten ranks per page; connected users retain their own rank beyond the top100. Public profiles separate lifetime awarded quantities and theoretical valuations from snapshot claimability, show twenty token types per page and include bounded award history, earned milestones and a labelled synthetic SVG download. No PnL is inferred.

Performance and sample-scoring requests wait for explicit optional runtime capabilities. Absent sources or failed discovery show unavailable states without issuing unsupported requests. The default Worker profile does not expose these synthetic extensions. The populated Node runtime also supplies their optional OpenAPI paths; no generated financial contracts change.

Consumer lists start small: ten tokens, six NFTs/receipts, six Airdrops/Stake rows and five Earn submissions/awards. Show more reveals the rest of the current server page; server pagination and the technical view remain available. The five category pages share Explain → Participate → Compete structure.

See [the populated review guide](../validation/THREE_MONTH_QA_GUIDE_2026-11-13.md), [the generator](../qa/README.md), [valuation rules](../performance/VALUATION_CONTRACT.md) and [AI review boundaries](../ai-review/README.md). `tests/performance-qa.mjs` runs the populated acceptance with installed Playwright; `BROWSER_ENGINE=webkit` uses the installed WebKit build without `BROWSER_EXE`.

The 25 November consumer pass replaces the long homepage with a featured meme, Season 0 Cards and compact discovery. Product help, the roadmap and community rankings use lazy expandable sections. Ranking views default to Market; Peak remains selectable. The permanent and seasonal collectible offers use distinct brand artwork; collection metadata and mechanics are unchanged.


The second 25 November pass adopts a sports-campaign visual direction: original action photography, self-hosted Barlow Condensed display fonts, charcoal/lime contrast and a light Season 0 feature. `brand.css` owns the shared treatment; `home.tsx` owns the campaign composition. [Asset provenance](src/assets/brand/provenance.json) records the built-in image-generation prompt and font sources; `OFL.txt` accompanies the fonts. PNG/TTF assets are explicitly allowlisted by the adapter, with same-origin font CSP. Brand browser checks cover 320/390/768/1440 px, loaded hero/fonts, navigation, disclosures, pricing and keyboard behavior.


## Six-month catalogue review

The app-local QA host can supply an explicit timeline manifest. `src/timeline.tsx` validates it and provides the timeline selector, current-edition feature, original-meme catalogue and searchable six-item season archive. Without that manifest the app retains its Season 0 launch presentation. Future editorial concepts never substitute for on-chain token identity or asset reveal metadata.

Tokens supports full-catalogue search and active/ended/upcoming filters through optional `q` and `status` parameters on the existing market read. Filter values are carried in navigation and bound to the stable pagination cursor. Earn queries active campaigns directly so newer history cannot hide an eligible campaign on another catalogue page. Contract declarations are regenerated from the OpenAPI source; no economic rules change.

The hero now uses `src/assets/brand/warplet-stratosphere.png`, generated from the existing Warplet reference with the built-in image tool. Its prompt and reference are in `provenance.json`. The Warplet is campaign artwork, separate from permanent NFT metadata.


The owner adopted the exponential brand architecture on 25 November. Hero copy now follows belief (“The future is exponential.”), mindset (“Think 10X. Not 10%.”) and rallying cry (“10X Everything.”). The shared mission is “Unlock exponential potential.” The purple Warplet reference supplied by the owner replaces the earlier green character; `warplet-exponential.png` is the active hero, with its prompt/reference recorded in the asset provenance file. Both launch and six-month views use this direction.
