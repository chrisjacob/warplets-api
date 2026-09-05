# Stonklets production release ? 2026-09-06

## Recovery points before release

- Worker version: `c9ad8a78-99f6-4ee3-8f70-36613b31c690`.
- Pages deployment: `dd2f9e13-6e1a-4af7-b871-8ddc737af14c` (commit `0fd6a53`).
- D1 bookmark before migration: `000001eb-00006c86-000050dd-3343ee2d264304d397bc7a270794aea1`.
- Pending migration: `0072_stonklet_voter_pages.sql` (two additive indexes).

## Release controls

Pages deployment depends on the successful Worker job, which applies migrations first. Daily Top 3 notifications remain disabled until production verification and Stonklets registration are complete.

## Validation before release

- App: 91 test files, 480 tests passed.
- Worker: all four test files, 18 tests passed.
- Root and app TypeScript checks passed.
- Production app build and performance budget passed.
- Security preflight passed. Dependency audit passes the repository high-severity gate with existing exclusions; two moderate advisories remain (fflate and stream-json). No audit exclusions were added for this release.
- Production D1, KV, Browser Rendering and share-image R2 bindings verified.

## Outstanding production setup

Stonklets custom domain/DNS and the existing market-provider secret require explicit approval after automatic review rejected the setup action. The production Farcaster account association and app FID are missing; requested from the owner. Do not enable the daily notification campaign before registration and audience checks pass.
