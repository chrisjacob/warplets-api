# 10X daily launchpad — local review

Start with [tonight's review](../docs/10x/REVIEW-TONIGHT.md) for the current walkthrough, owner actions and production gates. This package contains the local identity/rounds, accounting/settlement, markets/trading, mini-app, administration and QA foundation. Real launch execution, funding, claims and notification delivery remain disabled.

## Current populated review

From `.worktrees/10x-operations`, use these in separate terminals only if the corresponding service is stopped:

```powershell
pnpm --dir meme review:worker
pnpm --dir meme review:dev
pnpm --dir packages/meme-qa seed:serve
```

- Populated app: `http://127.0.0.1:5198/?qa=seeded`
- Admin: `http://127.0.0.1:5198/__adminhidden/meme?qa=seeded`
- Real Connect/local state: `http://127.0.0.1:5198/`

The frontend uses normal Worker port 8800 and isolated QA port 8801. Thirty launches, 240 fictional people, synthetic prices/trades/rewards and simulated actions are available in QA mode. Its toolbar changes personas/scenarios; the footer switches QA mode. Current seed storage is `.tmp/meme-qa/seeded-preview`, separate from `meme/.wrangler/review-state`. Preserve both; resetting is not a startup step. Apply pending additive normal-review migrations with `pnpm --dir meme review:migrate` when needed.

Read [ADMIN-AND-SEEDED-QA.md](../docs/10x/ADMIN-AND-SEEDED-QA.md) for QA/admin limits, [the product entry](../docs/10x/README.md) for the specification and [BUILD.md](../docs/10x/BUILD.md) for versioned rules. QA mode does not initialize real Connect or broadcast transactions.

## Earlier minimal preview

From the repository root, install with `pnpm install --frozen-lockfile`, then:

```sh
pnpm --dir meme dev
```

Open `http://127.0.0.1:5194`. Today, Rewards, Leaders and History read the separate minimal-preview database. `?fixture=1` opens the original read-only design fixtures without an identity or backend. Shared Connect supports Farcaster, Base and wallet verification; the local operator records ownership/holding evidence and resumes settlement. Financial transactions remain disabled. This older preview is independent of the current 5198 review.

The independent Worker and database can be exercised in a second terminal:

```sh
pnpm --dir meme db:migrate
pnpm --dir meme dev:worker
```

GET `http://127.0.0.1:8797/health` or `/api/meme/preview` for fixtures. The browser's shared Connect UI uses same-origin `/api/auth/*` routes, with proof verification and one-use challenges. Fixture/financial mutation routes return 405. Database state lives under `meme/.wrangler/state`, separate from the shared app and archived discovery stores. No real database ID is configured and no remote resource is created.

`pnpm --dir meme check` runs typechecks, request-boundary tests, frontend build and a Worker dry-run bundle. `pnpm --dir meme types` regenerates the local Worker environment declaration. There is no deploy script, production route or scheduled trigger. `build:worker` is explicitly dry-run only.

## Restricted phone QA

Use the compiled, access-controlled gateway described in [QA-ACCESS.md](../docs/10x/QA-ACCESS.md). It uses a separate database and exact temporary hostname. No shared product/dev hostname is exposed. Starting a tunnel requires a separate review.
