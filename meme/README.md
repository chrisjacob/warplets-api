# 10X daily launchpad — local milestones 1–3

Read `../docs/10x/README.md` and `../docs/10x/BUILD.md` first. This package is isolated local development. Its fixture preview is read-only; its separate loopback-only identity APIs support verified participation. Launch execution, funding and claims remain disabled.

From the repository root, install with `pnpm install --frozen-lockfile`, then:

```sh
pnpm --dir meme dev
```

Open `http://127.0.0.1:5194`. Today, Rewards and Launches read persisted local rounds, final entitlements and selection history. `?fixture=1` opens the original read-only design fixtures without an identity or backend. Shared Connect supports Farcaster, Base and wallet verification; the local operator records ownership/holding evidence and resumes settlement. Financial transactions remain disabled.

The independent Worker and database can be exercised in a second terminal:

```sh
pnpm --dir meme db:migrate
pnpm --dir meme dev:worker
```

GET `http://127.0.0.1:8797/health` or `/api/meme/preview` for fixtures. The browser's shared Connect UI uses same-origin `/api/auth/*` routes, with proof verification and one-use challenges. Fixture/financial mutation routes return 405. Database state lives under `meme/.wrangler/state`, separate from the shared app and archived discovery stores. No real database ID is configured and no remote resource is created.

`pnpm --dir meme check` runs typechecks, request-boundary tests, frontend build and a Worker dry-run bundle. `pnpm --dir meme types` regenerates the local Worker environment declaration. There is no deploy script, production route or scheduled trigger. `build:worker` is explicitly dry-run only.

## Restricted phone QA

Use the compiled, access-controlled gateway described in [QA-ACCESS.md](../docs/10x/QA-ACCESS.md). It uses a separate database and exact temporary hostname. No shared product/dev hostname is exposed. Starting a tunnel requires a separate review.
