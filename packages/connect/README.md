# Shared Connect

This package contains the existing Warplets Connect UI, Farcaster sign-in and mobile handoff recovery, Base Account/browser/WalletConnect controllers, and authentication clients. Existing app paths re-export it. `host.ts` accepts browser-only branding, analytics and haptic callbacks; it imports no application runtime.

`evm.ts` extracts account lookup, Base switching, message signing and wallet-review notifications from the original wallet module. Marketplace execution and transaction construction stay in the app. No discovery or Network imports are permitted.

Authentication uses same-origin `/api/auth/*` endpoints and host-scoped sessions. Each consuming application implements that contract; this package does not widen cookie scope or infer a Farcaster identity from an EVM address. Feature flags retain their existing defaults. The launchpad adds its own Solana reward-wallet section without replacing these connection flows.
