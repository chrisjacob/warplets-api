# 10X Social implementation and morning handoff

Updated 7 October 2026 (Australia/Sydney).

## Review the app

- Public compiled local preview: https://social-local.10x.meme
- Local admin: http://127.0.0.1:8793/social?page=admin
- Local private development UI: http://127.0.0.1:5178/social
- Start/restart the complete local stack: `pnpm --dir app local:tunnel:social`.
- The public preview requires this computer and the local processes to remain running. It uses local D1, not production D1. Existing production sites have not been deployed or modified.
- The Cloudflare tunnel `social-local` and its DNS route have been created. Its credentials live under the user's `.cloudflared` directory, outside this repository.

The launcher builds compiled assets, applies local migrations, and starts Pages on 8793, private Vite on 5178, a restricted preview proxy on 8794 and the tunnel. Stop these Social processes before restarting the launcher; other apps' processes should be left alone. New development changes need another production build to appear through the public compiled preview.

## Delivered

- Shared 10X shell/header/menu and responsive feed, search, post detail, onboarding, rewards, leaderboard and admin screens.
- Social hostname/path routing, favicon, PWA manifest, Open Graph/share images, Farcaster manifest, Base verification metadata setting, and server-generated post sharing metadata.
- Wallet or Farcaster authentication through the existing signed session infrastructure. Persistent generated wallet identity; explicit verified linking; merged identities retain posting cooldown, suspension status and reward history.
- Public browsing. One manual original or quote per rolling 24 hours, enforced by a database trigger. Comments and plain recasts cannot become main-feed submissions. Deletion does not restore the slot.
- Web text and links. Farcaster recent-cast selection, native composer capture and verification, signer-based text publication, image/video embeds and YouTube playback. Media uploads stay with Farcaster. X links use a safe outbound card.
- The feed contains intentional member submissions only. Automatic holder discovery was retired; holder points/ranking boosts remain.
- Local likes, comments, quotes and recasts; approved signer delivery for cast-backed actions. Native delivery uses stable operation IDs and recoverable states. Local historical engagement is not broadcast when permission is later granted.
- Points ledger, daily caps, chronological/trending/points ordering, daily/weekly/all-time leaderboard, 5-second active-view progress, engagement acceleration, streak and holdings evidence. Exploration unlocks points, not a transferable token claim.
- Four capped reward categories with a 10x total ceiling and a smaller maximum 2x post-ranking multiplier. Defaults and threshold details are in `app/shared/social.ts`; the existing launched Stonklet addresses are reused with a 10,000-token threshold. RPC multicalls check actual decimals before awarding holdings credit.
- Versioned admin configuration, numeric controls and advanced asset JSON, calculation preview, history/restore, reports, hide/restore, suspend linked identities, reward corrections, ingestion controls and audit records.
- A small nonpayable Base mainnet check-in contract, compiled ABI/bytecode and local EVM tests. Client and server use chain 8453 for both local and production app environments.
- Scheduled bounded refresh of recent submitted cast counts in the existing production scheduler, disabled by default until configured. It never discovers or imports holder timelines. Local bootstrapping can be run with `node --import tsx scripts/social-ingest-local.ts --local`.

## Items requiring account/wallet setup

1. **Farcaster app registration / domain association.** Generate a valid account association for `social-local.10x.meme`, then separately for `social.10x.meme`, and set `SOCIAL_ACCOUNT_ASSOCIATION_JSON` in the corresponding environment. The implementation deliberately omits a fabricated signature. Without this owner-signed association, browser preview works but mini-app installation and notifications need registration completed. Set `SOCIAL_BASE_APP_ID` if claiming the app in Base. The eventual `10x.social` hostname is not activated.
2. **Managed signer sponsorship.** Set `SOCIAL_APP_FID` and secret `SOCIAL_SIGNER_SPONSOR_PRIVATE_KEY` for the app's authorized Farcaster signer-request account, alongside the existing `NEYNAR_API_KEY`. No suitable Social signer credentials were present, so live cast/like/recast writes were not tested with a real member account. The permission button shows unavailable until configured; all native writes verify signer status and FID server-side.
3. **Mainnet check-in deployment.** A funded deployment wallet is required. The contract and deployment script are ready; no transaction has been sent and no deployer key has been created or reused. Run `node scripts/social-contract.mjs --deploy` with `SOCIAL_CHECKIN_DEPLOYER_KEY` supplied securely in the process environment and a Base mainnet RPC if desired. Set the returned `SOCIAL_CHECKIN_ADDRESS` in both local and production app configuration. The key must never go into source control or a client-side variable. Users pay their own check-in gas. Deployment writes a nonsecret receipt artifact.
4. **Production rollout.** Apply `migrations/0076_social.sql` to production D1, configure the preceding values, attach `social.10x.meme` to the existing Pages project, deploy the Pages app and the root scheduler, and enable `ingestionEnabled` in Social admin. Production deployment was left pending because the shared checkout contains substantial pre-existing Stonklets changes; deploying this entire tree would also ship that unrelated work. No production database migration was applied.

The existing admin key needs `social:admin`; the shared email-code sign-in endpoints also require `notify:inspect`. Admin key/session values stay in component memory. The public development proxy intentionally excludes all admin endpoints: use the loopback admin URL for local administration. Email-provider settings are the existing shared ones; no test email or external notification was sent.

## Explicit current limitations

- **Mini-app-context-only bonus is pending trustworthy host attestation.** Client SDK context and identity login do not prove the execution host to the backend. This 0.25 bonus is visible as pending and is not awarded from a spoofable browser flag. Farcaster connection, signer and persisted notification opt-in evidence are independently implemented. This needs a host-verifiable attestation mechanism or an explicit decision to accept a client-claimed bonus.
- **Points-first rewards.** No Attention Token distribution, claim contract or token allocation is enabled. The UI and ledger do not promise a token amount.
- Holder discovery uses the existing Warplets ownership index and is eventually consistent. It scans 100 FIDs per sweep and at most three provider pages per group, under an admin-configured request budget; exceptionally active groups can have incomplete 24-hour coverage. Holdings boosts additionally verify candidate NFT ownership onchain. Provider outages do not grant unverified boosts.
- Feed ordering currently considers the most recent 500 eligible records before pagination. This is appropriate for initial launch, but ranking should move to persisted scores/keyset pagination before larger volume.
- Farcaster embeds and media can become unavailable externally. Deleted external casts are not continuously reconciled as tombstones; local moderation and deletion work independently.
- Live host install/notification/signer/media flows require the registration and credentials above and a real Farcaster client. They have not been represented as end-to-end verified.

## Verification performed

- App and root TypeScript checks pass.
- Production Vite build passes; performance budget passes. The existing lazily loaded HLS asset retains its large-chunk warning.
- Social SQLite integration suite: 19 tests, including real migration SQL, cooldown trigger, identity merge/ban behavior, idempotency, exploration timing, recovery of interrupted reward writes, mute/search/auth and metadata rules.
- Latest focused Social + shared auth/security run: 46 tests pass. Earlier broader shared regression run: 138 tests passed before final Social recovery refinements.
- Contract compiled with Solidity 0.8.24, optimizer 200, Shanghai target; local EVM checks cover successful event, duplicate-day rejection, next-day reset, independent wallets and rejecting ETH payment.
- Public preview allowlist: 15 assertions covering approved routes and rejection of source, Vite, secrets, git, admin, unrelated APIs, traversal and source maps.
- Headless Chrome checks use an ephemeral unfunded wallet to sign a real local SIWE challenge, post, assert the 24-hour cooldown, inspect points and pages, verify responsive widths and open a post link. QA posts are labelled and deleted/hidden afterward. Screenshots are stored in `.tmp/social-qa/`.

Repeat checks (from the repository root with dependencies installed):

```powershell
pnpm --dir app typecheck
pnpm typecheck
pnpm --dir app exec vitest run functions/_lib/social.test.ts
pnpm --dir app build
node scripts/social-preview.mjs --test
npm install --prefix scripts/social-tools
node scripts/social-contract.mjs
node scripts/social-browser-test.mjs
```

The optional tools package pins solc, Ganache and Playwright without adding them to the production app. Browser checks use installed Chrome; `SOCIAL_CHROME_PATH` can override the executable and `SOCIAL_TEST_ORIGIN` the loopback test origin. Test tooling can also use the isolated `.tmp` installs created during this work.

## Main code locations

- UI: `app/src/SocialApp.tsx`, `SocialAdmin.tsx`, `SocialMedia.tsx`, `SocialApp.css`.
- Shared rules/metadata: `app/shared/social.ts`, `socialMetadata.ts`.
- API/storage/providers/jobs: `app/functions/_lib/socialApi.ts`, `socialStore.ts`, `socialProvider.ts`, `socialIngestion.ts`.
- Admin route: `app/functions/api/admin/social.ts`.
- Migration: `migrations/0076_social.sql`.
- Contract: `contracts/SocialCheckIn.sol`, `contracts/artifacts/SocialCheckIn.json`.
- Tests and local operations: `app/functions/_lib/social.test.ts`, `scripts/social-*.mjs`, `scripts/dev-tunnel-social.mjs`.

An initial request to expose Vite directly was rejected by automatic approval review because it could expose source and unrelated development endpoints. The accepted replacement serves only compiled assets and explicitly allowed Social/auth/email routes. Source and administrative routes remain unavailable through the public local tunnel.

## UI alignment follow-up

Social now follows the existing Warplets/Stonklets presentation: the shared 448px content column, 16px gutters, green segmented navigation, compact heading, black cards with green borders, raised actions, account menu and shared legal footer. Posting starts from a compact prompt and opens in a viewport-aware modal; drafts survive closing within the session. Quote, recent-cast, report and admin moderation forms use the same modal structure. Browser history supports the four main pages and post links, with feed scroll restored on return.

`node scripts/social-ui-test.mjs` checks 320px, 390px and desktop layouts with explicitly browser-only account/feed fixtures. It covers authentication prompts, draft retention, a shortened viewport, cast picker, quote/report forms, report retries, dropdown keyboard controls, history/scroll restoration, rewards, onboarding and empty states. `scripts/social-browser-test.mjs` continues to exercise real local SIWE/posting/cooldown/reward APIs. Comparison screenshots are under `.tmp/social-qa/aligned-*`.

This follow-up changes presentation and local preview asset access only. It does not change backend APIs, database schemas, rewards or mainnet settings.

Validation: TypeScript passes; the UI fixture checks pass at all three widths, including failed-image fallback and feed scroll restoration; the real local wallet regression passes; 30 focused Social/shell/onboarding tests and 15 preview route restriction checks pass. Reference app captures are saved as `.tmp/social-qa/after-*`. Short-viewport checks simulate keyboard-constrained space in desktop Chrome; a physical mobile keyboard and live Farcaster host permissions were not exercised by these browser tests.

The final production build and performance budget pass. The compiled local preview at `https://social-local.10x.meme` was verified to serve the rebuilt Social assets with no horizontal overflow at 390px. Production was not deployed.


## Second presentation review

Fixed missing provider/menu images in the restricted preview using exact public asset paths, added a failed-profile-photo fallback, and corrected Social's menu artwork. Removed the broad font reset that overrode shared component utilities; shared email controls keep their original typography, Social text-entry fields use 16px, and the rewards Refresh action now has an outlined treatment. Replaced external-link text arrows with consistent SVGs, removed the external arrow from local posting, and improved composer, link-card, button and narrow-header spacing.

Regression coverage now includes unavailable profile photos, provider icon loading, composer input size, and the shared email form's input/button sizes. Public preview screenshots cover rewards, menu, connection and onboarding at 320/390/1280px under `.tmp/social-qa/round2-*`.

The second pass passes TypeScript, the production build, performance budget, and 34 preview allowlist checks. The public compiled preview was checked for loaded menu/provider/onboarding images and horizontal overflow at all three widths. The 320px title now fits without truncation.

## Automatic holder feed retired

Removed the holder section, its browser requests, opt-out control and onboarding promise. Scheduled and forced ingestion now refresh only recent explicitly submitted casts, using a separate `post-refresh` lease; no holder/FID discovery remains. Legacy `section=bonus` requests return an empty feed, and archive search excludes imported-only casts. Existing stored data and deep links are retained without destructive migration. Holder points and ranking boosts are unchanged.

Validation for removal: 21 Social backend tests pass, including retired-feed/search exclusion and submitted-only refresh coverage. TypeScript passes. The local API returns an empty legacy holder feed.

The refreshed build and performance budget pass. Browser checks pass at 320/390/1280px and assert zero holder-feed requests. Production deployment remains separate.
