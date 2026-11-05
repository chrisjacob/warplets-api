# 10X browser client

This standalone React 19 / TypeScript application reads the versioned 10X API through its generated client. TanStack Router owns the five public routes and their shareable search parameters, TanStack Query manages remote state, and Vite with Tailwind v4 builds same-origin static assets. Native dialogs and form controls keep keyboard behavior in the platform. Wallet Standard discovery and an injected Solana fallback support message signing for local authentication.

From this directory:

    pnpm install --frozen-lockfile --ignore-scripts
    pnpm test
    pnpm build

These commands build local files under `dist/`. The host can compose `serveSite(request)` before its reference HTML handler. It returns null when a public route has no compiled build. Use the same local origin for signing challenges, submitting contributions and collection operations. The preview uses fixture data and has no production deploy script.

The development server binds to loopback by default. For an authenticated walkthrough use a compiled build with the API on the same origin. Package versions are pinned in the isolated lockfile to avoid changing the legacy applications.
