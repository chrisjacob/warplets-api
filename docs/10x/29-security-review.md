# Local security review — 21 October 2026

The highest-priority confirmed issue was private-file disclosure through the tunneled Vite server. Local requests returned HTTP 200 for `app/.dev.vars`, `discovery/.dev.vars` and a private `.tmp` rehearsal export. The responses were checked locally; no credential values or private exports are included in this report, source control or screenshots. This establishes exposure, not whether anyone else accessed those URLs.

## Implemented protections

| Priority | Confirmed issue | Change and verification |
| --- | --- | --- |
| Critical | Ignored credentials and private runtime files were readable over the preview HTTP server. | An early Vite middleware denies private names/directories, certificates, database/log files and Windows path aliases before proxy/static/transform handling. `server.fs.strict` and an explicit deny list provide another boundary. Tests include encoded paths, query variants, shared workspace imports and a copied secret under `public/`. Previously exposed real paths now return 403 with no-store. |
| High | Vite 6.4.2 had Windows development-server file-denial bypass and editor endpoint advisories. | Pinned and activated Vite 6.4.3, updated workspace and legacy app lock entries, and disabled the HTTP open-in-editor endpoint entirely. The installed preview runs the patched version on the existing port. |
| High | Legacy action endpoints accepted claimed Farcaster IDs on local/development hosts, including an unconditional local fallback for account reads and completions. Preview launchers also overrode private session keys with public, fixed strings. | Account completion/email reads and action mutations now derive FID exclusively from the signed session. Unsigned notification opens remain anonymous. Launchers load private session/VAPID material through ignored `app/.dev.vars`, without secret CLI bindings. No hostname or legacy flag restores the FID fallback. |
| Medium | Signed session parsers accepted extra token components and non-canonical signature encodings; the existing request-body helper read the entire body before enforcing its limit. | Action/admin sessions require exactly two bounded base64url components and a canonical SHA-256 HMAC, a safe-integer expiry, and an unexpired timestamp. Action FIDs must be safe positive integers. The bounded JSON helper counts streamed bytes and cancels excess input, even without an honest Content-Length. |
| Defense in depth | Discovery admin authorization accepted a bare credential; private GETs lacked the browser-origin boundary; malformed/oversized admin bodies did not have consistent client errors. | Strict Bearer scheme, constant-time comparison, allowed Origin and same-origin Fetch Metadata checks on private reads/writes, precise JSON media type and 32,000-byte bounds. Return 400/401/403/413/415 as appropriate before DB/provider work. Headerless authenticated local CLI/timer calls still work. API JSON and identity errors consistently receive no-store, nosniff, no-referrer, same-origin resource policy and a restrictive API-only CSP. |

The API-only CSP does not change the app's existing Mini App framing rules. Public action catalogs still load without a session; private completion/email details require one. Anonymous notification metrics do not establish identity. Discovery ownership verification, evidence/eligibility gates, source quotas, backoff, persistent databases and withheld voting/reward outcomes are unchanged.

## Credential containment and required owner follow-up

Completed locally, without printing values:

- Replaced the discovery operator/relay credential with cryptographic randomness. Both the old Worker token and old relay token return 401; their replacements authenticate successfully. The local supervisor/collector/timer resumed with the replacement.
- Replaced `APP_SESSION_SECRET`, `ACTION_SESSION_SECRET` and every configured local admin API key in ignored `app/.dev.vars`. Restarted the local Pages API on the same port/store without the old CLI overrides. A session signed with the former public placeholder returns 401; one signed with the new local secret reaches the expected unsupported-action 400 before provider work. Unsigned FID claims return 401.
- Disabled the legacy fallback flag in local configuration. Existing local logins must reconnect. The new secrets remain untracked; no deploy or remote secret mutation occurred.

**Provider credential rotation is still required.** The exposed app environment includes Neynar, OpenSea, Resend API/webhook, Dune, CoinMarketCap and Base notification credentials, plus VAPID private material. Revoke/replace those credentials in the owning accounts and update the private local configuration. If a value is reused in another environment, rotate it there too; blocking the preview does not revoke a copied key. VAPID rotation needs a coordinated push subscription renewal. `SECURITY_LOG_SALT` was also exposed; replace it when appropriate, accounting for the effect on historical audit correlation. Public VAPID/client IDs do not require revocation merely because they are public.

Provider/account management was not available in this task, so none of those provider revocations is claimed complete. Prior access cannot be determined from these checks. Review provider usage/access records when rotating. Restart any other already-running preview API that still uses old CLI overrides; updated launchers apply on their next start. Do not deploy as part of this follow-up without separate authorization.

## Validation and remaining work

- App: **795 tests / 134 files passed**, including real HTTP private-file fixtures, signed/unsigned endpoint identity cases, actual SQLite completion/email/notification checks, token tampering/expiry, and streamed byte-limit cancellation.
- Discovery: **303 tests / 31 files passed** and typecheck passed, including admin rejection before database access and existing identity/evidence/replay regressions.
- App typecheck/build and aggregate performance budget passed: **233.9 KiB gzip** static startup. The patched server rendered `/backing` through the existing tunnel; no browser errors were captured at verification.
- `node scripts/check-tenx-security-local.mjs`: 15 private requests denied, public pages/source available, ten admin/identity checks passed, and signed-session requirements verified through the API proxy. No provider calls or valid admin mutations are made by this check.
- Local operations check: timer recent, independent watchdog healthy, no issues; three retained election rehearsals replayed. Backing check: current frozen record and two earlier records replayed, outcome withheld. These read-only checks made zero provider requests.
- Workspace frozen-lockfile verification, launcher syntax checks, generated OpenAPI and `git diff --check` passed. Local database contents and tunnel routing were preserved.

This was a targeted review, not a penetration test or a clean dependency audit. After the Vite patch, the workspace audit still reports **19 low, 59 moderate and 45 high** dependency-path findings, with no Vite advisory remaining in the root audit. Those counts include the wider shared app and require reachability review rather than indiscriminate major upgrades. A concrete next maintenance patch is Vitest/@vitest/mocker 4.1.11 or later for its mock redirect file-read advisory; this workspace currently runs CLI tests on 4.1.10 without an exposed Vitest browser/UI server. Review remaining wallet/SDK/build dependencies, legacy unbounded body-reader call sites, and the wider shared app origin/proxy behavior next. Unrelated in-progress network snapshot changes are excluded from this security commit.

Repeat the checks from the repository root:

```powershell
pnpm --dir app test -- --maxWorkers=2
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app build
node scripts/check-tenx-security-local.mjs
pnpm exec tsx scripts/check-discovery-operations.ts
pnpm exec tsx scripts/check-backing-local.ts
pnpm exec tsx scripts/generate-discovery-openapi.ts
git diff --check
```

References: [Vite filesystem policy and public-directory caveat](https://v6.vite.dev/config/server-options#server-fs-deny), [Windows file-denial bypass advisory](https://github.com/advisories/GHSA-fx2h-pf6j-xcff), [Windows editor endpoint advisory](https://github.com/advisories/GHSA-v6wh-96g9-6wx3), [OWASP browser-origin/Fetch Metadata guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [OWASP HTTP headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html), [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
