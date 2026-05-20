# Two-Machine Parallel Development Workflow

Use `main` as the production-ready integration branch. Do all machine-specific work on short-lived feature branches, then merge only after syncing with `origin/main` and testing.

## Daily Flow

Start new work from a fresh `main`:

```powershell
git switch main
git pull --ff-only origin main
git switch -c feature/short-description
```

Commit and publish work from the feature branch:

```powershell
git status --short --branch
git add <specific-files>
git commit -m "Clear commit message"
git push -u origin feature/short-description
```

Before finalizing the branch:

```powershell
git fetch origin
git rebase origin/main
pnpm --dir app build
git push --force-with-lease
```

Prefer merging through a GitHub PR. For a small local fast-forward merge:

```powershell
git switch main
git pull --ff-only origin main
git merge --ff-only feature/short-description
git push origin main
```

## Branching Rules

Use one branch per problem space, for example:

- `feature/drop-checkout-fix`
- `feature/admin-notifications`
- `feature/web-homepage`
- `fix/warplet-status-cache`
- `ops/local-dev-docs`

Avoid editing the same large/high-churn files on both machines at the same time:

- `app/src/DropApp.tsx`
- `app/functions/api/warplet-status.ts`
- `app/functions/api/actions-complete.ts`
- `app/functions/__adminhidden/index.ts`
- `pnpm-lock.yaml`
- `app/pnpm-lock.yaml`

If both machines need the same large file, assign one machine as the owner and let the other work elsewhere until that branch is merged.

## Deployment Policy

Treat `git push origin main` as production-impacting. `main` triggers the production GitHub Actions deploy for the root Worker and app Pages project.

Use feature branches for parallel work. Merge to `main` only after testing.

Manual app deploy commands:

```powershell
pnpm --dir app deploy:dev
pnpm --dir app deploy:prod
```

Do not run dev/prod deploys from both machines at the same time unless the later deploy is intentionally meant to win.

## Safety Checklist Before Pushing Main

Run:

```powershell
git status --short --branch
git fetch origin
git rebase origin/main
pnpm typecheck
pnpm --dir app build
```

Review what will land:

```powershell
git diff origin/main...HEAD --stat
git log --oneline origin/main..HEAD
```

Only merge or push to `main` after this review looks right.

## Secrets And Local Files

Do not commit or branch local secret files:

- `.dev.vars`
- `.dev.vars.dev`
- `app/.dev.vars`

Keep secrets copied manually between machines or stored in a password manager.

Never use Git to sync:

- `.wrangler/`
- `.localflare/`
- `node_modules/`
- `dist/`
- logs
- Cloudflared credentials, unless transferred securely outside Git

## Conflict Recovery

If a branch falls behind:

```powershell
git fetch origin
git rebase origin/main
```

If rebase conflicts happen:

1. Open conflicted files and resolve them manually.
2. Continue the rebase:

```powershell
git add <resolved-files>
git rebase --continue
pnpm --dir app build
```

Avoid `git reset --hard` unless deliberately discarding local work.
