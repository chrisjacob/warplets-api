# Launchpad administration and populated local QA

Built for review on 31 October 2026. No deployment, public exposure, real messages or financial activation is included.

## Try it locally

Run these from the repository root in separate terminals:

```powershell
pnpm --dir meme review:worker
pnpm --dir meme review:dev
pnpm --dir packages/meme-qa seed:serve
```

For an existing normal preview database, first apply the additive local migrations with `pnpm --dir meme review:migrate`. Review mode directs `/api` to port 8800; the older 5194/8797 preview remains separate. QA requests use only port 8801.

- App: `http://127.0.0.1:5198/?qa=seeded`
- Admin: `http://127.0.0.1:5198/__adminhidden/meme?qa=seeded`
- Normal local app: `http://127.0.0.1:5198/`

The normal app footer and local admin checkbox can switch QA mode. The QA toolbar switches personas and scenarios, advances a paused demo clock, and resets only the QA dataset. Close and reopen the page to resume the same persisted generation. Use **Reset QA data** after changing the generator version.

The first generation takes time; later visits use the saved database. The server listens only on loopback. QA data lives in ignored `.tmp/meme-qa/seeded-preview/`, separately from `.wrangler/review-state`. Generation changes retain previous SQLite files; they never restore over the normal database. A completed generation is backed up from memory and only then published in `active.json`.

### What is populated

- Thirty prior daily launches and today's round; 240 invented people, fake Base/Solana addresses and simulated Warplet levels.
- Three candidates, advisory votes, ownership freezes, streaks, acquisition-value holding credit and immutable historical top-100 allocations.
- Synthetic OG and ATTN prices with gains and losses, exact trade replays, cohort rankings, trader profiles, accumulated rewards and rendered PNG share previews.
- Claims credit excluded inventory. They do not create purchase credit or invented realized trading profit.
- An active day, release window, recovery scenario with two skipped launches/unfunded releases, and an empty scenario.
- Vote/change vote, simulated buy/sell, one/all eligible claims, share previews and an operator selection/launch demonstration.

The clock is anchored to the current Sydney calendar date at a useful UTC time and pauses between actions. Clock advancement refreshes synthetic prices and cohort snapshots, closes prepared/open rounds at their boundaries and finalizes demo allocations with shared ranking/allocation rules. A newly launched demo edition starts at its simulated actual launch time. Publish additional rounds in Admin; the clock does not automatically choose candidates. The demo horizon is ten days per generation.

All prices, people, signatures and receipts in this mode are fictional. The UI launch demonstration creates synthetic records; it does not execute a protocol program or certify chain behavior. Separate captured-program tests retain that role. No real account is impersonated, no Connect SDK is initialized, and external network/RPC requests are fenced in the seed runtime. Sharing previews/downloads a watermarked card rather than opening a real composer. No notification transport is exposed through QA.

## Admin workspace

The new sub-page is `/__adminhidden/meme`. It shares the existing admin token and email-2FA system. Its four views are:

| View        | Work supported                                                                                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today       | UTC date, timetable/freeze, candidate research links, exactly three manually reviewed candidates, saved immutable shortlist, committed attribute cycle, publish/preparation job, selection/skip with reason, launch gates and release calendar |
| Performance | Materialized daily/previous/30-day/overall participation, returning voters, launches/skips, changed-vote accounts, accepted-cohort trading volume, per-edition allocated/claimed/reserve raw units                                             |
| Comms       | Verified-event previews, separate notification/social pauses, reviewed social drafts, explicit milestone rules and crossing evidence, Farcaster/Base outbox summaries                                                                          |
| Health      | Readiness gates, current controls, source coverage/budgets, persisted jobs and retry, audit journal and unresolved commands                                                                                                                    |

GMGN is a simple Solana trending feed: 1h default or 24h, provider order, at most 50 results. No custom scanner, scoring or automatic selection was added. Research links and manual mint entry remain available. Refresh is an operator command, never a public read side effect. Cached snapshots are immutable, each window has a 15-minute freshness guard, and each request consumes a durable allowance before I/O. Failures retain the previous good cache and consumed allowance. There are no automatic retries, quota resets or enrichment requests.

The adapter mirrors the installed official GMGN CLI's `/v1/market/rank` request: `chain=sol`, `order_by=default`, descending order and the provider's `renounced`/`frozen` filters. These tags are discovery filters, not a safety verdict. Market cap is not promoted to verified FDV. A server-only `GMGN_API_KEY` and separately reviewed allowance are required for live refresh. Neither was provisioned; the new allowance starts at zero. See the [official API documentation](https://docs.gmgn.ai/index/gmgn-agent-api).

### Authentication and binding

Tokens remain in page memory, never local/session storage. The Pages BFF checks the key, a same-key 2FA session, the action scope, origin, method, route and bounded JSON body. It supplies the actor; browser-supplied actor/environment fields are rejected. The private RPC service repeats capability checks. Reads use `meme:read`; writes use `meme:rounds`, `meme:comms`, `meme:ops` or `meme:launch`. New operators also need `admin:session` for 2FA bootstrap. Existing notification-admin bootstrap remains compatible.

Future deployment preparation must explicitly configure a private Pages service binding named `MEME_ADMIN` to the launchpad Worker entrypoint `MemeAdmin`. It must point to the intended launchpad environment/database, not the shared Network store. Example binding shape, for review only:

```toml
[[services]]
binding = "MEME_ADMIN"
service = "<approved-launchpad-worker>"
entrypoint = "MemeAdmin"
```

No binding, new remote resource, key or routing change was made. The deployed HTML always sets its QA flag to false; `?qa=seeded` cannot turn it on. Only Vite's loopback development shell enables the QA bridge. Without a binding, authenticated normal admin API calls return a clear unavailable response. The hidden URL itself grants no data access.

Every command has an actor-bound intent hash, stable ID, expected global version and durable journal. A persisted two-minute execution lease prevents concurrent requests from executing the same command together; a crashed runner must expire or reconcile before retry. Lost responses replay the same identity; changed intents and stale edits fail. Unknown outcomes retain a pending reconciliation fence. Shortlist publication uses the persisted command time, validates the committed cycle and cannot mutate a published shortlist or finalized settlement. No credential or raw provider error is stored in the journal.

### Communications and metrics limits

Refreshing event previews derives ready voting rounds, confirmed launches and finalized/funded/released allocations. It prepares social drafts for review, without posting. Editing a draft clears approval. Opening a composer requires approval of that exact version, an unpaused channel and a configured canonical HTTPS `MEME_PUBLIC_ORIGIN`. Opening is recorded separately from posting; no verified-cast adapter or automatic social transport is configured.

Milestones are a separate user topic, default off. The intended audience is every explicit milestone subscriber. A trusted adapter must verify fixed supply, revoked mint authority and fresh historical price provenance. A below-threshold baseline plus two above-threshold observations at least 60 seconds apart, without a gap over five minutes, produces one immutable event per edition/threshold. Starting above the threshold never emits a retrospective alert. GMGN discovery data and public/manual proof submissions cannot trigger it. The production proof adapter remains unconfigured; QA injects explicitly simulated evidence.

The bounded queue helper orders rewards, launches, voting and milestones in that order. The existing shared cap remains three distinct events per person/UTC day across Farcaster and Base; already consumed slots cannot be preempted. Registration and real delivery remain disabled. Existing fake transports retain unknown-outcome reconciliation and bounded retries.

Metrics are explicit materializations, not live replay on admin/public reads. Refresh covers 31 daily rows, up to 1,000 accepted trading sources in 64-source pages, and up to 4,000 reward allocations. Coverage limits are returned. Cohort trading volume is not whole-pool volume, trading fees are not protocol revenue, and different token raw units remain separate. Visitor conversion, collected protocol fees, runtime error counts, auth-failure totals and p95 latency remain unavailable until instrumented; the UI does not display invented zeroes.

## Verification and remaining gates

```powershell
pnpm --dir meme check
pnpm --dir packages/meme-qa seed:test
pnpm --dir packages/meme-qa seed:browser
pnpm --dir packages/meme-qa test:browser
pnpm --dir app test
pnpm --dir app build
```

CI runs populated desktop/mobile journeys alongside the existing normal-app regressions. Production builds check that seed data, simulated identities, QA controls and simulation UI are absent; the existing startup budget still applies. SQLite migration replay, FK checks, allocation conservation, claim inventory, boundary settlement, scoped 2FA, origin rejection, stale edits, idempotent commands, discovery allowances, reviewed drafts and milestone deduplication have dedicated coverage.

Optional real OG history is a later capture/import adapter; this build intentionally makes no paid/live market request. Physical Base/Solana wallet QA, live evidence certification, final economics/custody, public policy, production binding/telemetry and real notification registration still have their existing gates. Financial launch/funding/claims and deployment need separate authorization. EVM treasury preference remains Splits; it does not replace the approved Solana custody arrangement.
