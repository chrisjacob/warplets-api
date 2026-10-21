# PRD, design, performance and security review

22 October 2026 (Australia/Sydney). Reviewed at feature-branch baseline `f23da24`. This checkpoint changes requirements and priorities only. It evaluates 10X Discovery and its shared release/security boundaries; unrelated in-progress Network/legal changes are excluded. Findings from source, the local UI, current published limits, existing artifacts and tests are distinguished from unverified release claims.

## Assessment against the PRD

The engineering foundation is substantial; the central product promise is not yet demonstrated. We can browse, explain and replay a grade, but cannot yet show that the highest-ranked unfamiliar first-day tokens capture genuine attention while rejecting manipulation with acceptable false positives. More evidence panels or regression-specific penalties are unlikely to close that gap.

| Workstream | Delivered | Still required | Status |
|---|---|---|---|
| F1 comparable coverage | Chain-observed inventory, rotating selection, dated common records, request accounting and full retained coverage audit | Admitted unfamiliar-token observations, usable freshness/units/windows, measured affordable subset | Partial; data yield is the main product constraint |
| F2 daily workspace | Cards/table, exact-mint search, filters, three-token comparison, local shortlist and snapshot pagination | Faster first decision, wider desktop table, mobile/keyboard/zoom validation and image delivery measurement | Core functions delivered; usability acceptance open |
| F3 genuine participation | Recent candle windows, raw owner changes, acquisition/retention and signed native trade samples | Independent economic participation, historical valuation and qualified daily measurement | Descriptive samples delivered; organic 24h volume/growth remain held |
| F4 improved ranking | Frozen v1–v4 replay, dominant concerns and retained first-grade/outcome research | Separate paired study, formula preregistration, unseen mints/later-day holdout, independently reviewed labels and material-improvement criteria | No validated replacement for v4 |
| F5 reliability/readiness | Quotas/leases/backoff, watchdog, ownership-aware recovery, persistent start allowance and verified scratch restore | Inventory/storage capacity, affordable public reads, transport root cause, multi-day recovery/retention/off-device proof | Partial; concrete capacity risks now urgent |
| Backing/content/launch/rewards/chains | Signed identity, moderation and immutable accounting/economic/recovery rehearsals | Qualified vote/attention evidence, policy decisions, protocol/custody/legal certification and separately authorized execution | Foundations/labs; no live launch, vote credit or rewards |

Do not publish a percentage-complete number that treats a lab, source adapter or passing unit suite as completion of a product outcome. Maintain separate functionality, evidence qualification and release-readiness states.

The [484-token coverage audit](96-retained-activity-coverage-audit.md), cutoff `2026-10-21T15:57:48.158Z`, found only 20 fresh reported pool-volume values, no GMGN info/candle fields among 482 non-reference tokens, and no qualified organic-volume/daily-growth values. Its bounded source lookups and retrospective population are not a held-out study. At the current scheduled selection ceiling of three targets per UTC day, thirty distinct new targets require **at least ten admitted collection days**, even before failures/repeats; three UTC days alone cannot complete that target. This is scheduling arithmetic, not a new global/internal research quota. Token count and elapsed time do not establish model validity.

## Findings that change the build order

| Priority | Finding | Consequence and next deliverable |
|---|---|---|
| P0 | 486 retained live tokens at the measured snapshot; existing whole-inventory evaluator/audit guard is 500 | Only fourteen additional retained identities fit that guard at that time. Design/test a compact bounded current view plus an indexed historical lookup; preserve every old row/link/replay and explicit unknown/rejected cases. Test 501/1,000/5,000 history entries. Do not simply raise the evaluator bound or silently discard tokens |
| P0 | Local SQLite logical file is 1,070,039,040 bytes; holder evidence alone allocates 924,581,888 bytes | A direct copy into one D1 Free database cannot fit the published 500 MB limit. Produce an evidence-preserving storage/capacity design before declaring Discovery deployable or widening expensive full-owner scans |
| P0 before affected release | Current production dependency audit reports 4 high and 14 moderate findings | Triage package/advisory instances and actual browser/server reachability, patch compatible versions and rerun affected builds/auth/wallet tests. The static blocklist preflight passing is insufficient |
| P1 alongside admitted F1 | Expensive evidence/score work still occurs on read paths | Materialize compact versioned score/activity summaries through existing admitted maintenance; serve frozen pages without replaying all source payloads per visitor. Preserve current freshness semantics and independent action gates |
| P1 | Ranking is explainable but not prospectively validated | Collect unfamiliar tokens under existing admission, publish missingness/yield, then preregister paired evaluation. Keep v4; no score renormalization, provider-label-as-truth or regression tuning |
| P1 | First useful result is below the initial viewport; desktop table is constrained | Make the shortlist the first task surface, with progressive filters, compact context and an appropriately wide table. Keep evidence reachable and concerns visible |

These are engineering release constraints, not permission to delete evidence, reset counters, activate a service, enable paid usage or change a policy. Ordinary already-admitted collection may continue; capacity work must not manufacture fresh-looking observations or quietly reintroduce disabled internal research restrictions.

## Design review and revised acceptance

Observed in the local browser at 1280×720: the initial viewport shows header/navigation, title and a large filter block, with no token visible. Table mode renders a minimum-width 1,100 px table inside the narrow central shell, with horizontal scrolling and a 480 px nested vertical scroll region. This is a usability issue even though the controls and table are accessible in the tree. The score/coverage distinction and primary concern are useful; repeated timing/disclaimer/status paragraphs compete with the task. The review did not certify mobile, contrast or complete screen-reader behavior.

The next design slice should:

1. Show the first ranked identity/grade/coverage/concern in the initial viewport after successful loading at 1280×720 and 390×844. Keep search, age, sort and view immediately available; collapse advanced liquidity/coverage/freshness controls with active-filter counts and an obvious reset.
2. Give desktop comparison enough width; avoid simultaneous nested horizontal/vertical scrolling where a normal page can work. On narrow screens retain useful cards and a named, keyboard-accessible table region. Sticky identity/headers must not obscure focus.
3. Use one compact cutoff/freshness summary and one plain explanation of the experimental grade. Keep source-specific dates, caveats and exact replay behind details; never collapse away the main adverse concern or present reported volume as organic. Keep score and evidence coverage separately named and visually distinct.
4. Preserve artwork with explicit unavailable/loading fallbacks and exact-mint identity. Measure successfully rendered artwork, not merely presence of an image URL. Images earn no trust points; failures must not hide candidates or trigger unrestricted external fetches.
5. Validate the daily journey: find an exact mint, inspect its strongest support/concern and missing daily metrics, compare three identities, save one and reopen it. Target completion within two minutes after loading in five recorded scripted trials on declared viewports; later test with independent users. This is a proposed acceptance target, not completed usability research.
6. Review against [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/): keyboard order, focus visibility, names, announcements, contrast, 200% text and 320 CSS px reflow. Retain the project's 44 px control target; do not misstate it as the AA minimum. Tables may legitimately need two-dimensional layout, so horizontal scrolling alone is not proof of a WCAG failure.

Discovery remains the immediate product. Existing content/backing/launch/reward labs stay clearly labelled and secondary; no navigation or capability is opened on production by this plan.

## Performance and Free architecture

The existing built production artifact passes the bundle check: **232.5 KiB gzip across eleven static startup chunks**, under the 250 KiB shell budget; individual JS files remain under the 350 KiB budget. This is the thesis-only artifact already on disk, not a fresh build of the dirty working tree or a measurement of an enabled Discovery route. Discovery's entry graph needs its own budget and trace before exposure.

Seven sequential cached loopback reads completed at `2026-10-21T16:11:07.866Z`, with zero provider requests or database writes:

| Read | Samples | Full-body wall time | Decoded response size |
|---|---:|---:|---:|
| First-day card list | 3 | 480–618 ms | 109,551 bytes |
| Retained card list, first 100 | 3 | 1,285–1,614 ms | 144,599–144,844 bytes |
| Three-token comparison | 1 | 2,356 ms | 50,252 bytes |

Responses reported gzip and `no-store`. Recompressed sizes in the private measurement artifact are estimates, not exact transferred bytes. Small local samples are not p95, edge CPU, concurrent load, tunnel latency or Core Web Vitals. Chrome DevTools trace tooling was unavailable; LCP/INP/CLS remain unmeasured. Use the [current Web Vitals targets](https://web.dev/articles/vitals): p75 LCP ≤2.5s, INP ≤200ms and CLS ≤0.1, segmented by mobile/desktop when a valid measurement setup and later field sample exist.

Revised architecture/performance requirements:

- Keep offline investigation, raw receipt replay and full coverage/archive tools outside public request paths. A provider-free read can still be computationally expensive. Prepare compact snapshots under existing maintenance admission and cache/coalesce identical public reads by mode, query, source revision and cutoff; never cache private sessions/admin exports together with public results.
- Preserve ≤100 results per response and the current per-evaluation 500-candidate/4 MB guards until a versioned, tested index design replaces the whole-history dependency. Separate total retained history from bounded active evaluation. Exact historical mint lookup and old cohort/election replays must continue unchanged.
- Provisional engineering targets: decoded 100-card responses ≤250 KiB; warm cached-list p95 ≤1s and three-token comparison p95 ≤3s on a declared controlled fixture. Collect at least thirty samples and a bounded three-client concurrency exercise, then measure CPU, memory, query count and row reads separately. Targets do not authorize paid capacity or relaxing correctness; missed targets remain explicit.
- Validate the intended enabled Discovery routes against [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 limits/pricing](https://developers.cloudflare.com/d1/platform/limits/): currently 10 ms Free Worker CPU, 128 MB memory, 50 D1 queries per invocation and 500 MB per Free database. Local successful reads prove none of those remote budgets. Account for indexed row reads/writes, polling, all viewers, maintenance, errors and retries. Re-check the actual account/plan before any authorized release.
- Keep compact queryable indexes/projections separate from bulky immutable evidence in the design. Evaluate a private content-addressed compressed/deduplicated archive only with verified existing Free entitlements, an integrity/restore design and a measured growth worksheet. No raw evidence is moved, removed, truncated or made public here. Same-disk scratch restore remains useful but does not prove off-device recovery.

Private measurement artifact: `.tmp/prd-review-measurements.json`. The live file-size measurement is a logical SQLite allocation, not a remote billing reading or a sustained growth forecast. Holder bytes are a priority for study, not proof that an equivalent amount can be safely deleted or compressed away.

Retained measurement-file SHA-256: `b9b0a48bf3634281425576a36d917aeda3f1c401c33a79a24de99cf3501f4ae9`. The private dependency-audit JSON below has SHA-256 `ec364ac7328a408fe2f4635cfad773fed1ddebde31885c404eb5536d30a5519e`. These pins identify the review snapshots; they do not turn local measurements into production evidence.

## Security review and release boundaries

Verified strengths: local runtime/host guard; constant-time Bearer comparison and origin/fetch-metadata checks; bounded admin bodies; signed domain/browser/action-bound Solana challenges and HttpOnly/Strict session cookies; source/image URL allowlists and manual redirects; deterministic replay with immutable references; separate financial/action gates; source quotas/leases/backoff; and a fail-closed client/server/build thesis-only exposure flag. Saved shortlists contain identity hints, not credentials. These are scoped code/test observations, not penetration-test certification.

Concrete gaps to address:

- `pnpm --dir app audit --prod --json` returned nonzero. Its workspace production graph reported **0 critical, 4 high and 14 moderate findings**. Four high instances correspond to two unique `follow-redirects` advisories through `app → @base-org/account → @coinbase/cdp-sdk → axios → follow-redirects`: [array-form header stripping](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8) and [sensitive-header regex escaping](https://github.com/advisories/GHSA-8r9p-f939-6h3c). Both document 1.16.1 as the patch for affected 1.16.0. Confirm every installed path and compatible parent resolution; do not blindly force a transitive override or assume a browser exploit. Moderate results include workspace-root Hono paths and app transitive parsers; they are not all proven reachable in the thesis/Discovery bundle. Private raw report: `.tmp/prd-review-app-dependency-audit.json`.
- The shared HTML CSP permits inline/eval scripts and broad HTTPS connections. Develop route-appropriate nonce/hash policies and narrowly justified exceptions after testing existing wallets, embeds and other products; the restrictive JSON API CSP does not harden the HTML shell automatically. This review demonstrates policy breadth, not an XSS exploit.
- A feature flag controls exposure, not authentication. An enabled preview served through a public tunnel needs a separate reviewed access policy. CORS is not authorization or a denial-of-service control. Before Discovery exposure, bound/cache/rate-limit expensive public reads and independently test private/admin/session routes; preserve loopback relay authentication and fixed upstream destinations.
- Query keys, any signing keys and the admin capability remain separate. Do not transmit signing keys, add financial capabilities or store secrets in browser/local shortlist data. Keep full archives (including identity sessions) out of Git/public assets; verify OS permissions and encrypted off-device recovery before relying on backups. No secret rotation or access change is performed here.

For the next release, distinguish **thesis-only public release**, **authorized private Discovery preview**, **public Discovery** and **financial functionality**. Each has its own evidence. Closed routes/chunks must pass even for thesis-only; dependency findings require reachability/remediation review for the surfaces actually shipping. Passing the flag test alone does not make the complete shared app secure. Private/public Discovery additionally needs capacity, performance, data-claim and access verification. Financial functionality retains all independent protocol, custody, evidence and policy prerequisites. This review authorizes none of these releases.

## Revised near-term execution

1. **Capacity and security first:** prevent the known whole-history inventory failure through a versioned bounded index design, preserve old artifacts, and triage/patch reachable dependency findings. Produce a Free storage/query/CPU worksheet. Keep current production closed and existing evidence untouched.
2. **Useful, affordable browsing:** precomputed versioned read models plus the compact-filter/wide-table design slice; measure the daily journey and each enabled route's bytes/CPU/queries/latency. Do not rebuild existing labs.
3. **F1/F3 observation:** use ordinary admitted rotating collection with current pacing and capacity. Report attempted/new/accepted/fresh/complete/rejected/missing separately, both for all selected mints and the daily top twenty. Publish volume/holder window and provenance gaps; do not omit failed cases or reward raw wash/dust counts. Freeze freshness/service targets only after the measured capacity worksheet demonstrates feasibility.
4. **F4 qualification and study:** write economic participation/independence/valuation/window rules before outcome evaluation. Freeze A=v4, B=pinned provider heuristic if its fields exist, C=proposed hybrid and at most one sensitivity variant after coverage review; enroll all arms at a common cutoff in a new study namespace. Retain unavailable arms and independently reviewed positive/adverse/uncertain controls. Predeclare improvement and acceptable false-positive/missingness regressions; no automatic promotion at thirty mints or a calendar deadline.
5. **Readiness review:** verify broader outage/rollover/storage recovery and a complete bounded daily journey before requesting any Discovery release. Restore bounded internal research admission before production without altering today's authorized local-calibration mode. Preserve same-chain $10X, 50/20/20/10, zero founder $10X mint and all later-phase gates.

A short delivery record should answer: what user journey improved; what changed in unfamiliar-token coverage; what was actually measured; what remains unknown; and whether Free/evidence/release gates stayed intact. Avoid a growing sequence of documentation-only or token-specific milestones being mistaken for validation progress.

## Verification scope

**354 targeted tests passed in this review:** 150 Discovery UI/client-release tests; eight server/shared-release/admin tests; three built-release assertion tests; 39 request-security/identity/artwork/research-limit tests; and 154 content/duplicates/source-collection tests. Static security preflight and compromised-package blocklist tests passed; the current dependency audit did not. The existing bundle and thesis-only artifact checks passed. Browser cards/table were inspected in an agent-owned background tab and the user's tab was preserved. No new application build, provider collection, live database mutation, financial action, migration, runtime restart, package upgrade or deployment was performed. Whole-app exploitability, mobile accessibility, production CPU/query limits, real outage recovery and Core Web Vitals remain unverified.
