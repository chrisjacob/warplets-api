# Foundation validation — 30 October 2026 (Sydney)

This branch starts at released main `86b50a2553e9927ad9b47145aa14f58a1a09118a`, after Network serving activation PR #85. The archived discovery tag remains unchanged. The original worktrees and private data remain in place.

## Local foundation

- A fresh worktree installed with the authoritative root lockfile using `pnpm install --frozen-lockfile`. Existing dependency-age, exotic-subdependency and security rules remain enabled. Wrangler 4.154.0 meets the 24-hour age policy.
- `pnpm --dir meme check` passes package-boundary checks, frontend and Worker typechecks, two request-boundary/fixture regressions, Vite build and a Worker dry-run bundle. Generated environment types match the package configuration.
- `pnpm --dir meme db:migrate` creates only the package-local schema marker. The running local Worker returns fixture mode with actions disabled for health/preview reads, and HTTP 405 for a vote mutation. No remote resources were created.
- The independent UI runs on port 5194 and the local Worker on 8797. Today, Rewards and Launches render at desktop and 390px mobile widths without horizontal overflow. Claim and vote controls remain disabled. The shell includes operator selection/skip and actual-launch reward timing.
- Root typechecking, production dependency audit, existing app build, performance budget and production routing checks pass. The existing app's home startup is 235.2 KiB gzip against its 250 KiB budget. The production manifest contains neither the skeleton nor archived discovery code. A regression rejects a launchpad import in that manifest.
- The audit retains two previously documented ignored browser-installer advisories, two moderate findings and one low finding; it adds no unignored high finding.

The dedicated foundation workflow verifies the package independently and builds the existing app. It has no deployment step. The foundation remains on its own branch.

## Inherited production release

Preparation, data handoff, collection activation and serving activation are recorded in [the Network runbook](../network/RELEASE.md). Latest verified production APIs reconcile country and status totals against one immutable snapshot, support an older stored historical snapshot and return the optional Warplet portrait identifier. Current member-directory records can advance between aggregate snapshots; the existing behavior and freshness disclosures are preserved.

Live browser checks cover desktop/mobile country filtering, map drill-down, member search, directory pagination, Warplet portraits and membership history. The thesis, Warplet, Stonklet, Drop and shared legal pages return HTTP 200. Privacy/terms source parity, August archives and Social anchors are verified. No separate Social client or analytics setting changed.

Network serving is live at `https://app.10x.meme/network`. `https://network.10x.meme` also returned HTTP 200 on 29 October 2026 at 22:39 UTC, after the owner added its DNS record. A later UTC daily rollover has not yet occurred during this verification window; scheduled collection and multiple new snapshots have succeeded with unchanged provider caps. Daily refresh and November quota rollover observation remain operational follow-ups.

## Milestones 1–3 build — 30 October 2026 (Sydney)

The foundation observations above describe its original fixture-only commit. The subsequent six-PR stack implements local participation and settlement, as detailed in BUILD.md. It neither merges nor deploys the new application.

- Launchpad verification now includes 31 tests: Base/Ed25519 proofs and replay prevention, frozen ownership/link ambiguity, changeable votes and closing conflicts, cycle privacy, offered-round streaks, exact boost/holding arithmetic, receipt reconciliation, sealed-history imports, HTTP identity-to-entitlement flow, top-100 ties, exact token conservation, overlapping campaigns, concurrent retries and recovery after a committed page loses its response. The tests use generated keys and real isolated SQLite migration replay; they create no public FID sign-in bypass.
- Independent frontend/Worker typechecks, boundary checks and builds pass. The Worker bundle is approximately 1.86 MiB raw / 319 KiB gzip and remains dry-run only. Local migrations through 0007 apply in the separate `meme-local` state. No production schema, secrets, resource or provider caps changed.
- Root typecheck and security preflight/blocklist/redirect/Solana dependency tests pass. Production dependency audit retains the same two ignored high browser-installer advisories, two moderate findings and one low finding; no new unignored high finding.
- All 853 existing app tests pass. Production app build, 235.1 KiB gzip startup budget and release-isolation checks pass. The shared Connect extraction preserves compatibility exports; a development-only diagnostic notification discovered during browser QA now runs in an effect rather than during React render.
- Desktop and 390×844 browser checks cover Today, Rewards, history, shared Farcaster/Base/wallet Connect and scrollable Solana controls. Financial controls stay disabled. No horizontal overflow was observed. Original design fixtures remain accessible separately. Generated-proof HTTP tests cover allocations; signing with the owner's real accounts and physical mobile wallets was deliberately left for later manual QA.

Source completeness and historical USD quotes are still operator/source-attested. Observed receipt checks do not establish complete history, automated indexing or broad protocol coverage. These limitations, production abuse/economics review, protocol/distributor feasibility and funded claims remain explicit later gates, rather than implied production readiness.

## Evidence and operations integration — 30 October 2026 (Sydney)

The preceding source-attestation paragraph describes the milestone 1–3 stack. This integration adds independent history/oracle adapters and requires a fully verified evidence version for new observed settlements. Provider credentials, entitlement and exact allowances still require approval; Helius/Pyth budgets are zero and no live requests were made. These changes do not establish broad swap/Token-2022 coverage or production readiness.

Migration replay through 0010, paginated source/version verification, immutable corrections, stale leases, lost responses, quota preservation, old/new score agreement and 1,200-account snapshot publication are covered by automated tests. Public projections have a fixed query count and never replay ledger history or initiate collection. The actual local Wrangler runtime also applied the additive migrations and published an empty simulated-round snapshot; browser checks covered Today, Rewards and shared Connect cancellation without real-account signing. The QA instance used separate local state and ports 5294/8897, preserving the existing preview.

All 853 existing app tests, root/app typechecks, security preflight, the production app build and routing-isolation checks passed. Existing app startup remains 235.1 KiB gzip under its 250 KiB budget. Launchpad startup remains below its existing 80 KiB budget. Production rules and physical-phone signing are still unverified; see [RULES-REVIEW.md](RULES-REVIEW.md).
