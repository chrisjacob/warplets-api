# Preview recovery and launcher shutdown

21 October 2026, Australia/Sydney. Local continuation of PRD §§11.6 and 17.6 / P4. Recovered from `dde32e2` and the previous application checkpoint `fb9f207`. Unrelated Network snapshot work remains excluded.

## Restored preview

The existing `app-local` tunnel now uses Vite on loopback port **5183**, the App Pages API on **8788**, and the preserved **`app/.wrangler/10x-preview`** store. The tunnel restart immediately preceding this work had reused Warplets' API on 8790; recovery switched App back to the isolated store specified in the handoff. No database was reset or replaced. The isolated store had no pending migrations. Warplets, Stonklets and Network were preserved.

Discovery continues through the existing `10X-Discovery-Local` task and hidden supervisor, loopback port **8794**, and **`discovery/.wrangler/local`**. No second collector, task installation, remote resource or production schedule was added. No forced refresh or quota override was used.

## Recovery defect and change

During cached checks the existing Wrangler runtime exited, and the supervisor recovered its owned launcher. Investigation found a separate deterministic shutdown race: the launcher always installed its interval after the initial asynchronous cycle, even if Worker exit or a termination signal had already stopped the launcher and cleared its timer. Pending local HTTP work also waited for its individual timeout instead of being cancelled immediately on shutdown. This change fixes that race; it does **not** establish or fix the cause of the original Wrangler exit.

`scripts/discovery-lifecycle.mjs` gives the launcher one shutdown controller. Unexpected Worker exit (including exit code zero) and spawn error stop the timer, abort startup/collection requests and close the owned relay. Explicit stop terminates only the owned child tree, once. A completed initial cycle cannot install a timer after shutdown, and duplicate timer installation is rejected. Individual HTTP timeouts do not themselves stop later cycles.

The same six collection stages, request timeouts, non-overlap guard and 60-second interval remain. Local administrative fetches refuse redirects, unused/error bodies are cancelled, and successful response bodies retain shutdown cancellation while being read. The lifecycle uses [Node's composed abort signals](https://nodejs.org/api/globals.html#static-method-abortsignalanysignals) and closes incoming relay connections after stopping its listener, following the [HTTP server shutdown API](https://nodejs.org/api/http.html#servercloseallconnections).

The existing supervisor was retained and only its verified owned launcher tree was restarted to load this change. Restart admission remains three starts per rolling fifteen minutes; the three-failure watchdog rule and unowned-process protections are unchanged. There is no restart on provider backoff, exhausted budgets or an intentional pause. Cancelling a client request does not undo already-admitted Worker work; existing leases, quotas and durable checkpoints remain authoritative. An already-running relay upstream request retains its existing ten-second timeout. No wider financial recovery certification is implied.

## Coverage and constraints

The restored Discover page showed **0 eligible, 13 provisional and 62 excluded** within the verified creation window at the browser checkpoint. **0/10 recent eligible tokens** remains the actual result. Missing/stale holder and wallet evidence, funding coverage and source failures remain visible and blocking. The lifecycle fix does not improve those counts by itself.

The first recovered status showed RPC usage 4047/5000, wallet usage 770/800, market usage 536/600 and artwork usage 120/120 for the then-current UTC day. These are timestamped recovery observations, not fixed quotas remaining now; the normal bounded collector continues. Read current Data status for current usage and source backoff. Validation reads made zero provider requests. No additional provider, paid service, higher allowance, evidence waiver or policy activation was introduced.

## Validation

- `node --test scripts/discovery-lifecycle.test.mjs scripts/discovery-watchdog.test.mjs scripts/discovery-relay.test.mjs`: **15 passed**. Six new lifecycle tests include stalled headers/body over real loopback HTTP, cancellation, timer non-resurrection, idempotent explicit stop, spawn/clean-exit failure, independent timeout and natural subprocess exit with a real relay listener. No Wrangler, provider or live database is used by these fault tests.
- `pnpm --dir discovery test`: **676 tests / 44 files passed**, including evidence, quota, pause, replay and the fourteen-day offline reliability scenarios.
- `pnpm --dir discovery typecheck` and `pnpm --dir app typecheck`: passed.
- `pnpm --dir app build`: passed, including the unchanged performance budget; home startup **234.1 KiB gzip across eleven chunks**, below 250 KiB. Existing dependency annotation warnings remain non-fatal.
- `node --check scripts/dev-discovery.mjs`, `node --check scripts/discovery-lifecycle.mjs` and `git diff --check`: passed.
- `scripts/check-discovery-operations.ts`: recent timer, fresh independent watchdog and three retained election replays. State remains degraded by the retained wallet source issue; the checker correctly requests no restart for it. Zero provider requests.
- `scripts/check-discovery-wallet-plan.ts`: **0/10 eligible**, four wallet snapshots replayed, one new-snapshot plan and ten source-limited plans, with no currently recoverable cached/reader markers. Wallet usage was 771/800; all checked provider caps and the active policy matched their existing values. Zero provider requests and no gate changes.
- Browser review through the existing HTTPS tunnel: Discover renders the actual incomplete coverage, a real token detail keeps provisional status, charts and expandable creation/holder/wallet evidence, and `/thesis` renders the original landing experience. No wallet signing or operator credential entry.
- `node scripts/check-tenx-security-local.mjs`: fifteen private requests denied, public routes available, ten admin/origin/body checks passed and signed action identity required. Zero provider requests or valid admin mutations. Browser Data status also shows the recent heartbeat/watchdog separately from the retained RPC source degradation.

No schema, eligibility/scoring, signed-wallet review, provider budget, launch, reward, treasury or social-publication capability changed. The homepage remains empty; `/thesis` retains the landing experience. No deploy.

Next: continue P3 funding/source coverage using replayable retained evidence and certified paths within existing free allowances. Ten recent eligible tokens remains unmet. Full voting/settlement fault certification, real wallet/device QA, external alert destinations and the previously recorded provider-credential follow-up remain open.
