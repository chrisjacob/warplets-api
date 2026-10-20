# Private contributor follow-up for content holds

21 October 2026 (Australia/Sydney). Advances PRD §§7.1, 14.2 and 15.1, and P8a in the [task map](19-prd-task-map.md). Product documents guide implementation; the founder's local-only, free-first, no-deploy and unchanged-evidence-gates instructions control execution. Extends [private reports and independent holds](33-content-reports-and-holds.md).

## Contributor and moderator workflow

A signed submission owner can now **Request a hold review** from their private held submission. They provide an explanation and optionally a public supporting HTTPS URL. **My hold review requests · private** lists their conversations; **Verify private conversation** loads and verifies the full message history and separately observed current hold flag. Other contributors, including the original reporter, cannot read this conversation unless they also own the submission.

The operator's [Contributor hold reviews](https://app-local.10x.meme/admin/10x#hold-review) queue filters by state. The operator reads the verified conversation before replying, may request one additional response, or close the conversation. Moderator replies are explicitly contributor-visible. The UI warns never to copy reporter identities, private complaint details or internal notes into these replies. No original complaint fields or moderator report reasoning are copied automatically. Human operators must still follow that confidentiality boundary.

```text
request → OPEN
OPEN → NEEDS_INFO → RESUBMITTED → CLOSED
OPEN → CLOSED
NEEDS_INFO → CLOSED
```

Only the signed owner can respond, and only from `NEEDS_INFO` to `RESUBMITTED`. Operators cannot impersonate the contributor or start another information round. Closure is terminal for that conversation. A conversation can remain open after an independent hold release; it is not silently rewritten or automatically closed.

**Requests, responses and closure never release a hold.** The operator must separately review the original reports and release each upheld hold as appropriate. The underlying submission must also be `VISIBLE` before public featuring resumes. This workflow establishes neither authorship, rights, engagement, reward eligibility nor whether a complaint is true. There is no real launch, reward credit, public posting or automatic adjudication.

## Privacy, replay and bounds

Migration `0027_content_hold_reviews.sql` adds separate projections and immutable event tables. A case binds its owner's identity, submitted URL, immutable content hash and an opaque hash of the verified upheld-report set. Report IDs, reporters, complaint text and their references are never returned through the contributor case API. The internal hold-set guard is used only for atomic admission; it is not stored in contributor-visible history.

New admission checks the currently held source submission and signed owner, replays report evidence, and compares the exact sorted current hold set inside the D1 insert. Releasing or changing holds between the read and insert prevents stale admission. A submission can have one active conversation and one conversation per distinct hold set. Closing a case does not permit reopening the same hold set; a changed set can admit a new case after the previous case closes. No amend/reopen or general support inbox is introduced.

Technical limits are **three new requests per identity per UTC day**, **twenty globally per UTC day**, **100 case events per UTC day**, **four events per case**, and **twenty rows per private page**. Admission and replies apply limits atomically. Daily event exhaustion can delay a moderator response; there is no hidden quota bypass. These are local resource controls, not proof of human uniqueness or production moderation capacity. Retention, archival, staffing and abuse escalation remain open; no automatic purge is added.

Hash replay checks target binding, stable case identity, every actor/action/transition, revisions, chronological order, previous hashes, request hashes, immutable event metadata and final projection. Duplicate UUID retries return verified retained history without another event; changed reuse conflicts. A reply event ID cannot be reused to create an orphan case projection. Optimistic revision/hash guards admit at most one competing update; projection/event failures roll back together using [D1 batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Hashes detect corruption; they do not protect against a fully compromised database owner.

Owner writes reuse strict schemas, lexical HTTPS URL restrictions, signed HttpOnly sessions, exact Origin/Fetch Metadata admission, `X-Tenx-Identity: 1`, and a streamed 4 KB body bound. Sessions are rechecked after the body and inside writes. Operator routes use existing Bearer/browser/body protections. Private responses use `no-store` and `Vary: Cookie`. Private queues refresh every fifteen seconds while visible and on focus; failed reads clear lists, and token removal hides operator rows. A displayed hold flag reflects the last explicit conversation read, not a live subscription.

Messages are escaped text; public references are ordinary no-referrer external links, never fetched or embedded. No dependency, provider, secret, external message, paid service or collector is added. Case requests and local D1 reads use zero provider calls. Existing discovery evidence gates, free-source limits, historical records and reward/economic policies remain unchanged.

## Validation

- Full discovery regression run: **355 tests across 34 files passed**. After the final collision guard and additional adversarial cases, **all 30 focused content tests passed**, including hold-set changes during admission, session revocation during a streamed body and reply-ID reuse.
- **20 focused app tests across five files passed**, including protected contributor administration, confidentiality warnings and escaped message/reference rendering, plus existing contributor/identity/navigation/shell checks.
- The expanded `scripts/check-attention-content-local.ts` passed with actual disposable Ed25519 sessions in a separate Workerd/D1 runtime: owner-only request, moderator information request, owner response, moderator closure, four-event replay, reporter privacy, unchanged original content and an independent hold retained after closure. The original report was then separately released through its original workflow. Zero user-wallet use, zero external provider calls, zero synthetic records in the main application database; the owned runtime stopped afterward.
- Discovery/app typechecks and app build/performance checks passed. Home shell startup remains **233.9 KiB gzip**; the lazy content chunk is **9.96 kB gzip**. OpenAPI contains all previous paths plus seven case routes.
- Additive migration applied to the existing local preview without resetting data. Browser review verified the protected queue through HTTPS without entering an operator token or connecting a user wallet. Local security checks denied fifteen private-file paths and passed ten operator admission checks; the collector timer/watchdog remained healthy and three retained rehearsals replayed with zero provider calls.

Commands from the repository root:

```powershell
pnpm --dir discovery test
pnpm --dir discovery test -- src/content.test.ts
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

Next: source-specific authorship/provenance, controlled moderation capacity/retention, near-duplicate evidence and validated votes/referrals/engagement. Discovery funding coverage and the ten-eligible-token target remain open; this contributor milestone changes no eligibility outcome. Reward policies, live entitlements/claims and deployment require their separate prerequisites. [Provider credential rotation](29-security-review.md) remains an owner follow-up.
