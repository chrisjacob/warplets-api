# Local preview and validation record

20 October 2026, Australia/Sydney. No deployment command was run. Work is on `codex/10x-thesis-foundation`; the route change was committed/pushed as `cc8ba27` before starting the preview.

## Files changed

- `app/src/App.tsx`: empty home content; previous landing content only on thesis; dropdown link for connected/disconnected accounts; page-specific title and correctly refreshed social-card observer.
- `app/src/main.tsx`: resolves `/thesis` (including trailing slash) to thesis mode.
- `app/src/miniAppChrome.tsx`: notify the existing root router after programmatic push/replace so logo/back navigation updates the displayed page.
- `scripts/dev-tunnel-app.mjs`: optional local Vite port and persistence directory; check port availability before migrations. Both migrations and API use the same optional local store.
- `docs/10x/`: original source documents and requirements, primary-source review, architecture, threats, milestones, decisions and this record.

## Preview configuration

The existing default local database has unrelated schema/migration bookkeeping drift (`duplicate column name: strategy_version`). Leave it intact. The preview uses a newly initialized store at `app/.wrangler/10x-preview`; all existing migrations completed successfully there. An unrelated Farcaster app occupies port 5173; leave that process running. Use port 5183 for this preview. The script defaults remain 5173 and the normal local store when overrides are absent.

From repository root in PowerShell:

```powershell
$env:APP_LOCAL_VITE_PORT = '5183'
$env:APP_LOCAL_PERSIST_TO = '.wrangler/10x-preview'
pnpm --dir app local:tunnel
```

This starts Vite at `http://localhost:5183`, the local Pages API at `http://localhost:8788`, and the existing named `app-local` tunnel. The persistence path is relative to `app/`. Preview URLs:

- [Empty homepage](https://app-local.10x.meme/)
- [The 10X Thesis](https://app-local.10x.meme/thesis)

This run was started hidden in the background with `node scripts/dev-tunnel-app.mjs`, inheriting the two overrides above, and stdout/stderr redirected to ignored `10x-preview.out.log` and `10x-preview.err.log`. Do not start a second copy while these ports/tunnel are active. Stop the specific launcher and its child processes when finished, rather than killing every Node/cloudflared process on this computer.

## Commands and results

| Exact command | Result |
|---|---|
| `pnpm --dir app typecheck` | Passed |
| `pnpm --dir app test` | 128 files, 773 tests passed |
| `pnpm --dir app build` | Passed TypeScript/Vite build and performance budget; dependency annotation warnings only |
| `pnpm --dir app exec wrangler --version` | 4.126.0 |
| `node --check scripts/dev-tunnel-app.mjs` | Passed after launcher changes |
| `git diff --check` | Passed |
| `git switch -c codex/10x-thesis-foundation` | Created isolated feature branch |
| `git add app/src/App.tsx app/src/main.tsx app/src/miniAppChrome.tsx` | Staged route changes |
| `git commit -m "Move 10X landing content to thesis route"` | `cc8ba27` |
| `git push -u origin codex/10x-thesis-foundation` | Pushed; local and remote hashes matched |

The launcher ran `pnpm wrangler d1 migrations apply warplets --local --persist-to .wrangler/10x-preview` from `app/`, then Vite, local `wrangler pages dev` and `cloudflared tunnel run --url http://127.0.0.1:5183 app-local`. No `--remote` migration, Worker publish or Pages deploy was invoked. Public/local homepage HTTP checks both returned 200; the tunnel registered connections and the local API reached ready state.

Source-copy SHA-256 checks matched the attachments exactly:

- PRD: `3AF23D2F1886281101A158670DB1D50171ADAB0A19057D6FFE3887ACE6EF8D8B`.
- Agent brief: `DE2E99A8C7D97FF171C6494888CAF1EE72A33258C861115197C69E22BF0BA7D3`.

Browser verification through the public tunnel confirmed: empty homepage content; title dropdown includes **The 10X Thesis**; clicking it reaches `/thesis`; original heading, YouTube player, waitlist and nine social cards appear; clicking the logo returns to empty `/`; back navigation restores `/thesis` and the correct document title. The unconnected preview was checked without signing in, joining the waitlist or publishing anything. Connected-account link is present in code and typechecked but was not exercised with a real account. Screenshots are saved to ignored `.tmp/10x-home.png` and `.tmp/10x-thesis.png`.

## Assumptions, toggles and impact

Only actual new configuration knobs are `APP_LOCAL_VITE_PORT` and `APP_LOCAL_PERSIST_TO`. Future financial/discovery switches in the architecture are proposals, not configured/enabled features. The free-first budget preference is recorded; legacy Gecko API limits, production data permissions, exact AMM math/devnet proof, policy parameters and financial decisions remain unresolved in the register.

Homepage shell/header/account/footer remain available; content region is intentionally empty. Original thesis video/waitlist/social cards are preserved. Remote deployment branches/workflows were not changed. Local state is isolated and not a copy of production users; absence of existing local sign-ins or waitlist rows in this preview is expected.

Next step: certify the read-only Solana/Pump evidence adapter and fixtures, then implement discovery domain/schema/APIs and candidate/admin/status screens according to the plan. Exact protocol simulation and devnet proof remain separate mandatory launch-validation work; do not claim them from this UI checkpoint.
