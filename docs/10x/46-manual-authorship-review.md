# Recorded manual authorship reviews

21 October 2026 · PRD §7.1 and task-map P8a. Local only, free services, no deployment. Existing discovery evidence gates, content admission, visibility and report-hold rules remain unchanged.

## Implemented behavior

`/admin/10x#content-authorship` lets the local operator load a submission's original author claim and verified review history. To record `MANUAL_REVIEWED`, the operator must supply a public HTTPS source reference, a private explanation and an explicit assertion that they inspected the source and its relationship to that claim. A signed submitting wallet alone does not establish external authorship.

The immutable receipt binds the submission UUID, exact content hash, author claim, canonical reference, private reason, operator role, time, revision, request hash and predecessor hash. Revisions alternate between `MANUAL_REVIEWED` and `WITHDRAWN`; neither action publishes, rejects, rewards or releases a report hold. Withdrawal records a retraction of the earlier review, not an allegation against the contributor. A withdrawn review can be followed by a fresh review within the bounded history.

Visible, unheld content has an explicit **Check recorded author review** action. It requests a redacted local summary only when clicked. Labels distinguish no manual review, manual source review and withdrawal, with the recorded time. Private explanations, evidence references, event IDs and contributor identity IDs are omitted. Hidden or held submissions return 404. References are never fetched, embedded or posted by the app.

The label is an operator assertion as of a recorded time. It is **not cryptographic external-account control, a unique-human check, certified rights, verified engagement or reward qualification**. The original content snapshot remains `authorship="unverified"` and `reward_eligible=false`; its historical hash is unchanged. Manual review receipts are a separate evidence stream.

## API and storage

- `POST /api/10x/admin/attention/authorship/review`: explicit operator review or withdrawal, stable request UUID and optimistic `expected_revision` (`-1` for the first decision).
- `GET /api/10x/admin/attention/submissions/:id/authorship`: operator-only replay of zero to ten private events.
- `GET /api/10x/attention/authorship/:id`: public redacted summary for a currently visible, unheld submission. Publication admission is rechecked before responding.

Existing local-runtime, bearer, browser-origin and bounded JSON guards apply. Reads use `Cache-Control: no-store` and `Vary: Cookie`. Signed contributors cannot write reviews or read private authorship evidence. Removing/replacing the operator token hides private state and prevents stale asynchronous reads from restoring it.

Migration `0031_content_authorship.sql` adds one append-only event table, unique `(submission_id,revision)` and immutable update/delete triggers. A single SQL statement atomically checks the predecessor, head revision and daily new-review quota. There are at most **twenty new manual reviews per UTC day** and **ten total events per submission**. The final slot is reserved for withdrawal; withdrawal does not consume the new-review quota. An exact UUID/body retry returns its original event even after withdrawal or at the quota. Conflicting reuse and concurrent stale decisions fail.

The private content-operations view now includes manual-review quota usage, withdrawals and an eighth bounded storage sample for these events. Withdrawal counts are shown separately, so retracting a review never looks like a new-review slot or consumes its quota. These remain projection counters; decisions and case exports replay full histories.

The migration was applied only to the existing local store using:

```powershell
pnpm --dir discovery exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
```

No remote binding, secret, paid service, signer, external account permission or publication capability was created. D1 [prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/) bind request values; existing [local Wrangler development](https://developers.cloudflare.com/workers/wrangler/commands/) is retained.

## Export compatibility

Case export captures authorship rows in the same transaction batch as the original submission, campaign, reports and contributor follow-ups. A case with authorship events uses `content-case-export-v2`, adds the complete `AuthorshipHistory`, its component hash/count and includes its events in the manifest total. The existing one-MiB UTF-8 cap still applies; corrupted or over-bound histories fail without truncation.

Cases without authorship events still emit v1. The v1 schema, normalized hash order and offline verifier remain compatible with earlier artifacts; old cases do not acquire a claim about an authorship stream they never captured. V2 verifies actor, target, original author claim, transitions, time, canonical reference, predecessor links, complete retained revision chain and checksum.

Both versions work with:

```powershell
pnpm exec tsx scripts/verify-content-case-export.ts C:/path/to/private-case.json <independently-retained-checksum>
```

Checksums are not signatures or independent proof that a case includes every historical record. The original separately retained checksum remains necessary to detect replacement/omission by someone who can recompute an unsigned artifact. Private notes and references remain confidential download contents.

## Verification

- **636 discovery tests across 43 files passed**, including twenty new authorship cases in the 72-test content suite. Coverage includes explicit source confirmation, canonical private references, exact retry/conflicting UUIDs, concurrent head/quota admission, UTC reset, withdrawal at the new-review quota, ten-event history/final withdrawal, immutable rows, actor/target/transition/hash corruption, public redaction, moderation/report independence and v1/v2 offline export replay.
- **Ten content UI tests passed**, including the three public labels, gated private controls and escaped author claims/private notes. Discovery and app typechecks passed, as did the app build and startup budget. Home startup remains **233.9 KiB gzip**; the lazy content/moderation chunk is 60.06 KB / 15.90 KB gzip. OpenAPI now has **84 paths**.
- The disposable Workerd/D1 signed flow verified operator review, exact HTTP retry, withdrawal, public-label redaction and held-target 404. It exercised both v1 and v2 offline CLI replay, retained old content/follow-up histories and separately released the original report hold. Its held v2 artifact contains nine history events, including one manual authorship receipt; after withdrawal the authorship stream has two events. Zero provider requests, user-wallet use or main preview content writes occurred.
- The actual eight-event v1 artifact retained from the preceding milestone also passed the new offline verifier with its original checksum `84034c2f9a9ca842b9d87bdb0545346337f63da462d1aaee95a3ab5a6218ea59` unchanged.
- Read-only local security checks passed: fifteen private requests denied, ten admin browser/body checks and signed action sessions required. Local operations verified empty main content queues/storage and the updated aggregate schema. Browser review through the existing tunnel confirmed one authorship panel with disabled UUID/load controls without the operator token, no private notes displayed and explicit manual-review limitations.

Commands run from the repository root:

```powershell
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app typecheck
pnpm --dir app exec vitest run src/discovery/AttentionContent.test.tsx
pnpm --dir app build
pnpm exec tsx scripts/check-attention-content-local.ts
pnpm exec tsx scripts/check-content-operations-local.ts
node scripts/check-tenx-security-local.mjs
```

The signed-flow check uses disposable identities and a separate local database, leaving the main preview content tables empty. No new configuration toggle is needed; the existing local-only/disabled financial and publication capabilities remain in force.

## Remaining PRD work

Source-specific connected-account/challenge verification; plagiarism/near-duplicate evidence; validated engagement, votes and referrals; real reward entitlements; controlled archival/restore and an approved retention policy. Manual review implements the PRD's clearly marked manual path; it does not certify those other capabilities. Ten eligible recent tokens remain an unmet discovery target and are unaffected by this content milestone.
