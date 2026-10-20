# Private content reports and reversible visibility holds

21 October 2026 (Australia/Sydney). Advances PRD §§7.1, 14.2 and 15.1 and P8a in the [task map](19-prd-task-map.md). Product documents guide implementation; the founder's local-only, free-first, no-deploy and unchanged-evidence-gates instructions control execution. This extends the [signed contributor workflow](30-content-review.md), independently of launch/reward activation.

## What is available

Visible campaign links now offer **Report a concern** for rights/permission, impersonation, unsafe content, or spam/manipulation. A reporter needs the existing signed Solana browser session and a good-faith confirmation, an explanation, and optionally a public supporting HTTPS URL. A wallet identifies the reporting account; it does not prove the allegation or human uniqueness.

Supporting links undergo the existing URL canonicalization and lexical restrictions. Neither reported content nor supporting URLs are fetched, copied, embedded or posted to an external service. Reporters are told not to include credentials, private contact details or copied media. This is a local editorial concern/review workflow, not authorship certification, automated fraud adjudication or a formal legal-notice process.

**My reports · private** appears for signed contributors. Report reasons, references, identity and review history are available only to the reporter and local operator. The author of the reported submission receives only the current visibility-hold indicator in their private submission list; they cannot read someone else's complaint details. Public campaign responses expose none of those report details or reporter identities.

The operator's **[Content reports & visibility holds](https://app-local.10x.meme/admin/10x#report-review)** panel provides a filtered private queue, revision-bound decisions and verified history. The transitions are:

```text
report → OPEN
OPEN → UPHELD | DISMISSED
UPHELD → RELEASED
```

An `OPEN` allegation never hides a link. `UPHELD` adds an independent hold on public featuring. `DISMISSED` adds no hold. `RELEASED` removes that report's hold, but public visibility also requires every other upheld hold to be released and the underlying content state to be `VISIBLE`. Ordinary content review or owner appeal cannot bypass report holds. Dismissed/released reports are terminal; this milestone has no reopening or report-amendment flow.

Reports remain possible for visible links in ended review campaigns while the reporting session is valid. Hidden, unpublished or already-held targets are not available for new reporting; their lookup returns the same not-found result as an unknown submission. One reporter can file only one report per submission, including after dismissal/release.

## Evidence, privacy and bounds

Migration `0026_content_reports.sql` adds separate report projections and immutable event tables. Each claim binds the canonical content URL and hash of the immutable content details. Initial and subsequent snapshots retain the explanation/reference. Events link previous hashes, request hashes, actor, timestamp and revision. Full replay validates the projection, target binding, allowed transitions, stable claim fields, actor and every event hash. Finished history cannot be overwritten or deleted through ordinary SQL. These hashes support corruption detection, not protection against a fully compromised database owner.

The source submission's moderation status, immutable snapshots and event hashes are preserved. `visibility_held` on private record responses and `held_submission_ids` on page responses are derived projections outside historical hashes. Public lists exclude held links and verify report histories before returning remaining items; detected history corruption fails closed. Public pages contain no held IDs. An in-flight response reflects its read observation; already-open pages cannot be remotely recalled. Visible pages refresh cached records every fifteen seconds and on focus.

Reporting reuses the existing exact Origin, Fetch Metadata, `X-Tenx-Identity: 1`, strict JSON and streamed **4 KB body bound**. Admission checks the session again after body parsing and inside the D1 write, so revocation/expiry cannot authorize a delayed new claim. Reporter-supplied identity, actor, status and review fields are rejected. Operator decisions use the existing Bearer/browser authorization and body limits. Private responses use `no-store` and `Vary: Cookie`. The UI clears unavailable private lists and hides operator rows when the token is absent; signed-out report forms are disabled and their unsent explanation/reference are cleared.

Claim/event creation and revision/event updates commit in a D1 batch under optimistic revision/hash guards, following [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Duplicate UUID retries create no second event; changed reuse conflicts. Retried report reviews return the latest verified record containing the original decision, without reapplying that decision after a later release. Competing moderators cannot both update one revision.

Local technical bounds: **three new reports per signed identity/day**, **thirty globally/day**, **ten total reports per submission**, **150 report events/day**, **twenty rows per private page**, and **three events per report**. Limits apply atomically, including concurrent admissions. These bounds limit local resource use; they do not establish Sybil resistance or adequate production review capacity. A malicious group could consume report capacity. Additional evidence/administrative handling and an archival procedure remain needed; a moderator can still use ordinary content takedown controls. No automatic purge is introduced.

There are no new dependencies, secrets, providers, timers, source requests or paid resources. New signed-in report/queue polls read local D1 only. Remote D1 storage, query/CPU allowances, retention policy and production moderation staffing remain uncertified. All content continues to have unverified authorship, unavailable engagement and no reward credit. Discovery gates, source quotas, historical research/backing/election evidence and economic decisions are unchanged.

## Validation

- **349 discovery tests across 34 files passed.** The 21-test content run also passed after the final CSRF/body/pagination assertions. New cases cover reporter privacy, signed admission, canonical references, multiple independent holds, ordinary-appeal bypass resistance, duplicate/concurrent requests, rollback faults, terminal transitions, time/revision conflicts, quotas, session revocation, immutable events and corruption detection before public exposure.
- **19 focused app tests across five files passed**, including report sign-in gating and escaping hostile claim text without embeds/referrer access, plus existing contributor, identity client, navigation and shell behavior.
- The expanded `scripts/check-attention-content-local.ts` passed against a separate real Workerd/D1 runtime with disposable Ed25519 identities. It verified actual signed reports, reporter-only reads, private/public separation, uphold/release visibility, unchanged underlying content state, report hash replay, canonical duplicates, ordinary appeals, competing reviews, pagination and revoked sessions. It used no user wallet, made zero provider calls and wrote zero synthetic records to the live local database. Its owned runtime was stopped afterward.
- Discovery/app typechecks, app build/performance checks and generated OpenAPI passed. Home startup remained **233.9 KiB gzip**; reports remain in the existing lazy content chunk. All sixty previous OpenAPI paths remain, with six new report routes.
- Local migration applied without resetting data. Preview security checks denied fifteen private-file paths, passed ten operator Origin/body checks and still required signed-action sessions. The local timer/watchdog remained healthy and three retained elections replayed with zero provider calls. Browser review verified the protected report queue through the HTTPS preview without entering operator credentials or connecting a user wallet.

Commands from the repository root:

```powershell
pnpm --dir discovery test
pnpm --dir discovery test src/content.test.ts
pnpm --dir discovery typecheck
pnpm --dir app test -- src/discovery/AttentionContent.test.tsx src/discovery/navigation.test.ts src/discovery/walletIdentityClient.test.ts src/spaHistory.test.ts src/MiniAppShell.test.ts
pnpm --dir app build
pnpm exec tsx scripts/check-attention-content-local.ts
pnpm exec tsx scripts/generate-discovery-openapi.ts
pnpm exec tsx scripts/check-discovery-operations.ts
node scripts/check-tenx-security-local.mjs
git diff --check
# From discovery/, local only:
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
```

Next P8a work: source-specific authorship proof/provenance, contributor follow-up to a hold without exposing reporters, controlled capacity/retention, near-duplicate evidence and validated votes/referrals/engagement. Reward policy approval, cutoff scores, entitlements and claims remain separate prerequisites. The ten-eligible-token target and broader funding/backing coverage remain open; [provider credential rotation](29-security-review.md) remains an owner follow-up.
