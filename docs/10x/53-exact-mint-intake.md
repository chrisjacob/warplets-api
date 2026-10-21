# Bounded exact-mint discovery intake

Implemented 21 October 2026 (Australia/Sydney), following PRD §§4.4–4.6, 11.2/11.6, 13.1, 15.1 and 17.1. The [Kimchi review](52-kimchi-review.md) showed that a named live token could be absent from the bounded migration-authority inbox. Operators can now request an exact Solana mint without manufacturing candidate evidence or forcing source work.

## Behavior

- **Admin → Queue token review** validates a full Solana address, requires the existing operator Bearer authentication, origin/body restrictions and a reason, and saves an idempotent request. Arbitrary URLs, extra fields and client-supplied eligibility are rejected. Submission itself makes zero provider calls.
- The normal **paced discovery cycle** checks one queued canonical Pump curve. It still acquires the existing lease, checks mainnet, respects pause/backoff and reserves room for contender quality/wallet work. Explicit unpaced refreshes do not advance this queue.
- A request scans at most **three pages of thirty finalized signature references**, reading at most **two transaction bodies per turn**. Those bodies replace part of the existing **six-body ceiling**, including version-recovery work; the shared **24-RPC cycle cap** and its existing pacing estimate remain unchanged.
- An additional **twenty source reservations per UTC day** bounds intake inside the shared RPC allowance. This is a subset, not twenty extra calls. Reservations include attempts stopped by another quota or provider failure. Validated saved transaction bodies can be reused without another intake/global RPC reservation.
- Signature pages, pending references, read outcomes and hashes survive interruption. Source failure retains the pending body. Changed/expired lease ownership or pause prevents committing a returned page/body or admitting a lead. Unsupported transaction layouts and archival misses are retained as gaps rather than retried indefinitely within a request.
- A successful, finalized, canonical migration must match the **exact requested mint**. A WSOL-quoted match becomes an ordinary `tenx_leads` entry, retaining its transaction and hash. Existing creation, graduation, mint/pool, holder, wallet/funding, age and freshness checks then run through the ordinary inspection path. Admission confers no eligibility, rank, vote or launch authority.
- A canonical migration with another quote mint receives **unsupported_quote**, retaining its source body and quote identity. No unsupported pool enters the candidate pipeline. A bounded scan with no match or an expired 24-hour request remains an explicit gap.
- At most **eight active requests** and **one hundred retained mints** are accepted. Duplicate submissions reuse the original request, including terminal outcomes; they do not reset cursors, source allowances or retry limits. A full queue returns a structured error. Automatic retention/archival and explicit versioned rechecks are future work.

The signature search is deliberately non-exhaustive. It inspects the canonical Pump curve, not arbitrary markets, token-holder activity or every pool. A token may be pre-graduation, outside the scanned window, unsupported, or absent from provider history. A page/body hash proves the saved input can be replayed; it does not establish beneficial ownership, organic trading, safety or a complete history.

## Inspect and operate locally

[Data status → Requested token reviews](https://app-local.10x.meme/status#mint-reviews) reports the full mint, queue state, pages, read outcomes, source reservations, observed quote and migration/body links when available. A candidate link appears only when a live candidate actually exists. Reading status makes zero provider requests and grants no operator authority.

From the repository root:

```powershell
node scripts/discovery-operator.mjs review-mint CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump
node scripts/discovery-operator.mjs mint-reviews
node node_modules/tsx/dist/cli.mjs scripts/check-discovery-mint-reviews.ts
```

The CLI reads the existing private operator configuration without printing it. The check uses cached loopback APIs and the preserved local SQLite store in read-only mode. It checks unchanged policy, canonical curve identity and available page/migration hash receipts. A zero-receipt result means the scan has not produced retained evidence; it is not a successful target verification.

API contracts:

- `POST /api/10x/admin/mint-reviews`: authenticated, schema-validated enqueue only.
- `GET /api/10x/discovery/mint-reviews`: bounded cached public status; no reason text, request credential or provider URL.

The additive **local** migration is `0033_mint_review_intake.sql`; it was applied to the existing `discovery/.wrangler/local` store using Discovery's pinned Wrangler 4.126.0. Existing evidence, stores, source configuration, schedules and policy were preserved. There was no remote migration or deployment.

## Validation and live limits

- **725 Discovery tests across 46 files passed**, including 27 intake tests: identity validation/impersonation, queue caps/idempotency/audit, pause/lease expiry/replacement, source ceilings, durable continuation, missing bodies, hash-verified cache reuse, wrong slot/signature/future time, exact-mint admission, unsupported quote retention, source 429, shared six-body limit, ordinary pacing/backoff/contender reservations and denial of unpaced intake.
- **58 discovery UI tests across nine files passed**, including queue loading/empty/error states, unsupported quotes and migration admission without invented candidate links.
- Discovery and app typechecks passed. The local app build passed; home startup remains **234.1 KiB gzip across eleven chunks**, below the unchanged **250 KiB** budget.
- Existing security smoke passed: **fifteen private-path requests denied** and **ten admin origin/body checks**, zero provider calls. The new API integration test separately verifies anonymous/cross-origin denial and strict request schema.
- OpenAPI regeneration is stable with **89 paths**, preserving the previous 87 and adding the two intake contracts. The built Discovery chunk includes the final styled mint input and duplicate-request feedback.
- Browser QA verified the live queued Kimchi record, expanded progress/no-candidate state, Admin mint input, disabled submission without the operator token, and the Data status link. No credential was entered into the browser.

Live Kimchi request: `CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump`, queued at **2026-10-21T00:04:40.859Z / 11:04:40 AEDT**. At the **00:06 UTC** cached check it remained **queued**, with **zero intake reservations**, **zero page receipts**, **zero migration bodies** and **no candidate saved**. The displayed ordinary discovery tick was due at **00:16:13 UTC / 11:16:13 AEDT**. Submission did not change that schedule or force a refresh. A subsequent cached coverage check still reported **0/10 eligible**, unpaused collection, RPC **41/5000** and market **2/600**. These are historical observations; read status for current progress. No new eligible token is claimed.

Remaining work: observe bounded source results for Kimchi, replay any migration receipts and finish its independent creation/account/holder/wallet/funding review. Non-WSOL quote verification/pricing/trade analysis and original/copycat attribution remain open. Ten recently created, fully eligible tokens remains an unmet goal. Data status also reported `election_snapshot_size_limit` for the new daily rehearsal during QA; that separate failure requires investigation and has not been cleared or represented as a successful election by this change.

Free services only; no source cap or evidence gate was relaxed. No deployment or financial/social execution occurred. Unrelated Network work remains excluded from this milestone.
