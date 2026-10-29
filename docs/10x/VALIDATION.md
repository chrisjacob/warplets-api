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

Network serving is live at `https://app.10x.meme/network`. `network.10x.meme` is registered on the same Pages project and awaits the owner-added proxied CNAME to `10x-app.pages.dev`. A later UTC daily rollover has not yet occurred during this verification window; scheduled collection and multiple new snapshots have succeeded with unchanged provider caps.
