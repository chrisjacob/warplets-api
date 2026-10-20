# Signed external-content submissions and local moderation

Implemented 21 October 2026 from PRD §§2.3, 7.1, 13.1, 14 and 15.1. This advances the contributor workflow independently of launch approval, voting, scoring and reward settlement. Document requirements inform the feature; the founder's free-first, local-only, no-deploy instructions control execution.

## What is usable

- `/attention` lists local review campaigns; `/campaign/:id` shows their reviewed links. `/submit?campaign=:id` provides the URL form. Content appears in the existing discovery navigation and retains the app shell.
- The operator opens an explicitly labelled **local review** campaign in `/admin/10x#content-review`, supplying a title, Solana OG address and reason. Its clock starts at server admission and ends exactly ten 24-hour periods later, with an exclusive end. There can be at most ten open windows. Creation is immutable, hashed and idempotent. This creates no spotlight, launched edition, token supply or budget, and does not verify OG eligibility or endorsement.
- Contributors sign in through the existing Solana ownership flow at `/wallets`. Submissions require that origin-bound HttpOnly session, exact Origin, same-origin Fetch Metadata when present, `X-Tenx-Identity: 1`, a strict JSON schema and the existing streamed 4 KB body limit. A connected wallet or claimed account ID is insufficient. The session is checked again inside the write transaction to prevent a concurrent logout/unlink from authorizing a new write.
- The form accepts a public HTTPS URL, type, author claim and commentary, plus explicit rights and feature permission. Nothing is posted to an external account. No copyrighted media is downloaded/copied, and no URL is fetched, scraped or embedded. Canonical URL text is visible before a visitor chooses to open it; outgoing links use `ugc nofollow noopener noreferrer` and no-referrer.
- A private owner list shows pending/rejected/flagged submissions, review explanations and appeals. A private operator queue supports state filters, cursor pagination, revision-bound decisions and full history verification. Only `VISIBLE` submissions appear in the public campaign feed. Public projections omit the contributor's local identity, private explanations, audit actors and request hashes. All responses are no-store; private content uses Vary: Cookie.

The actual local application starts with **zero review campaigns and submissions**. The operator chooses which OG to review. Synthetic contributors, signatures and URLs are exercised only in an isolated runtime/database, without a user's wallet. No real or hypothetical campaign is silently promoted into this new workflow.

## URL identity, review states and evidence

URL canonicalization merges supported X/Twitter status aliases (including media suffixes), YouTube video aliases and Farcaster/Warpcast post host aliases, strips fragments and common tracking parameters, and sorts remaining query keys. Generic web query values and trailing-path distinctions are preserved. Non-HTTPS URLs, URL credentials, explicit non-default ports, IP literals, obvious local host suffixes, control characters and common private credential query parameters are refused. These are lexical checks, not a claim that arbitrary domains or content are safe. DNS is never resolved by this feature.

`(campaign_id, canonical_url)` is unique in SQLite, including concurrent admission. A URL reused in a different campaign starts `FLAGGED` for manual relevance/duplication review. This is a warning, not a finding of fraud. Near-identical media/body detection and proof that two social aliases represent one real post remain gaps without content evidence.

The implemented state machine is:

```text
submit → PENDING (or FLAGGED for cross-campaign URL reuse)
PENDING / FLAGGED / APPEALED → VISIBLE / FLAGGED / REJECTED
VISIBLE → FLAGGED / REJECTED
FLAGGED / REJECTED → APPEALED (owner only)
```

No-op decisions and stale expected revisions are rejected. Rejected items require an owner appeal before reconsideration. An appeal does not restore visibility. Initial submission plus nineteen changes are the local history bound; the final revision must be hidden, preserving the ability to take a visible item down. At that bound, further review requires a future documented archival/review procedure, not history rewriting. `REWARDED` is intentionally unavailable.

Every snapshot retains **authorship = unverified**, **engagement = unavailable**, and **reward_eligible = false**, including after manual visibility review. A signed wallet proves ownership of that wallet, not authorship of a social post, uniqueness of a human, originality, permission or organic engagement. Consent/author text is a contributor claim, not provider evidence. Review reasons are display-only data and grant no authority to an AI, signer or scoring policy.

## Persistence, concurrency and budgets

Local migration `0024_content_review.sql` adds separate campaign, submission and append-only event tables with indexed admission times, owner/feed/status cursors, URL uniqueness and immutable campaign/event triggers. Existing discovery, identity, backing, reward and financial records are unchanged.

Submission and initial audit event commit in a D1 batch. Review/appeal events and the current projection update together, guarded by expected revision, previous event hash, current session where applicable, and bounded admission. Conflicting concurrent reviewers cannot both overwrite the same revision. Faults roll back both event and projection, following [D1 batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

An event contains its request hash, previous hash, immutable content snapshot, actor category/identity, reason and timestamp. Full replay validates the sequence, allowed transitions, stable content/ownership, hashes and current projection. The projection and ordered history are read in one SQLite statement, avoiding a mixed revision during concurrent review. Hashes detect corruption and support reproducibility; they are not an external signature or protection against a fully compromised database administrator.

UUID retries do not append a second event. Changed reuse returns conflict. Review retries return the retained original event even after later changes; submission retries retain the original submission identity and return its latest verified review history. Reads enforce owner/operator access before returning private history.

Technical local limits: ten simultaneous review windows, twenty campaign admissions per UTC day, ten submissions per identity/day, one hundred submissions globally/day, and three hundred combined submission/review/appeal events/day. Atomic SQL admission applies even under concurrency. The identity limit does not establish Sybil resistance; the global limit bounds local abuse/cost. Lists return twenty entries plus a validated cursor, and review histories contain at most twenty events. A live changing feed can move between pages; it is not an immutable ranking snapshot.

No new dependencies, secrets, environment toggles, timers, external APIs or provider requests are introduced. Visible pages refresh cached local records every fifteen seconds and on focus; stale asynchronous results are ignored, requests are aborted on navigation, and unavailable private/session data is cleared. The content UI is loaded only on its route or in Admin, preserving the existing home startup budget. There is no retention purge yet; remote D1 storage/CPU and public-traffic budgets remain uncertified. Nothing was deployed.

## Validation and review

- **315 discovery tests across 32 files passed**, including twelve new content tests: signed/private access, consent/CSRF/body bounds, platform aliases, canonical duplicate races, global and identity admission, concurrent review conflicts, atomic fault rollback, appeals, end boundaries, revoked-session rechecks, immutable records, past-event tampering and preservation of a final hidden revision. Slow-body requests recheck the admission clock and session after parsing, preventing backdating across expiry/cutoff.
- **18 focused app tests across five files passed**, including contributor-content escaping/no embeds/referrer policy, route/query handling, existing wallet ownership client, shell and navigation behavior. No wallet connection/signature was requested from the user.
- The isolated `scripts/check-attention-content-local.ts` exercise passed against real Workerd/D1 with disposable Ed25519 keys: actual signed submissions, idempotent creation, canonical duplicate rejection, owner-only reads, reject/appeal/review races, private history replay, more than twenty visible links with a second cursor page, operator queue and logout revocation. It writes zero records to the live local app database and makes zero provider calls; its owned runtime is stopped afterward.
- Discovery/app typechecks, app build/performance budget, generated OpenAPI and local security checks passed. Home startup remained **233.9 KiB gzip**; content UI is a separate lazy chunk. The main local migration applied successfully without resetting existing data. Operations checks replayed three retained elections. The timer and watchdog remained recent; a later check reported `wallets_source_issue` / `unsupported_transaction_version` in the existing wallet collector, with no restart recommended. That coverage gap remains visible and does not change the gates or quotas. Browser review verified public empty states, signed-session gating and protected Admin controls through the existing HTTPS tunnel, with no captured browser errors.

Commands from the repository root, all local:

```powershell
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app test -- src/discovery/AttentionContent.test.tsx src/discovery/navigation.test.ts src/discovery/walletIdentityClient.test.ts src/spaHistory.test.ts src/MiniAppShell.test.ts
pnpm --dir app build
pnpm exec tsx scripts/check-attention-content-local.ts
pnpm exec tsx scripts/generate-discovery-openapi.ts
node scripts/check-tenx-security-local.mjs
pnpm exec tsx scripts/check-discovery-operations.ts
git diff --check
# Migration, from discovery/:
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
```

Next content work: source-specific authorship proof records and provenance, rights complaints, review capacity/archival rules, near-duplicate evidence and anti-abuse signals. Verified votes/referrals/engagement, policy approval (D11/D12), immutable cutoff scores, boosts, real entitlements and secure claims are prerequisites for rewards. The separate goal of ten eligible tokens and P6 historical USD/complete wallet history remain open. Provider credential rotation from the [security review](29-security-review.md) also remains an owner follow-up.
