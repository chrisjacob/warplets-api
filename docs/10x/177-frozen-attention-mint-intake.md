# Connect frozen attention leads to bounded mint intake

23 October 2026, Australia/Sydney. Continues [176](176-attention-holder-cohort-readiness.md). No deploy.

## Delivered

- [x] Add a private local command that replays independently pinned cohort and readiness artifacts before submitting their exact selected identities to the existing authenticated mint-review queue. Selection, empty strata, original order and all selected members remain fixed. The shared verified-artifact reader preserves the existing verifier's return format and replay checks.
- [x] Retain an exclusive, flushed journal under the original cohort directory before any HTTP submission. Keep original file pins, plan hash, the full selected denominator and endpoint; retain each attempt before sending it, then retain a strictly validated acknowledgement. The fixed journal cannot be reopened, including after partial work, a crash or lost response. Files stay beneath the repository's real ignored private root, independent of the invocation directory.
- [x] Restrict submissions to the fixed loopback endpoint. Use the existing local operator token in memory, disable redirects, time out each request after 15 seconds and cap acknowledgement bodies at 4 KiB. Reject changed pins, invalid credentials, a future cutoff or a plan over two hours old before creating a journal. Recheck plan freshness before each member. Never retain arbitrary response bodies, transport errors or credentials.
- [x] Stop after the first uncertain, rejected or invalid acknowledgement. Preserve the attempted identity as uncertain and the remaining members as unattempted; do not retry, substitute or silently drop them. An acknowledgement is queue status, including an existing terminal request, not migration proof or qualification. Existing global mint identity deduplication prevents reopening terminal work even if another cohort selects that identity.
- [x] Reuse the ordinary verifier rather than add another RPC executor. Queue submission reserves no provider calls and grants no qualification, score or action credit. Subsequent verifier work remains behind the existing paced discovery lease, pause/backoff controls, global/subset budgets, contender reservations, chain check, bounded signature/body reads and canonical migration/quote/age verification. Candidate creation/state and holder qualification retain their original separate gates.

No Worker route, scheduling policy, provider limit, migration or production flag changed. The historical cohort still cannot dispatch RPC itself; this separate journal authorizes only submission to the existing local queue. The command's zero provider requests describes its own work, not future scheduled verification. Total qualification cost and Free-serving acceptance remain unknown/held.

## Ordinary local result

The original checkpoint176 cohort was used without reselection or a new cutoff. Both identities were acknowledged. Original position1 was already an expired mint review and remained expired with duplicate=true; its 21 previous body checks were not reopened. Original position11 was newly queued. The adverse-control slot remained empty. The initial read-only status snapshot found the new request queued with zero pages/body checks and the normal next-refresh time intact. A second read-only snapshot at 19:37 UTC still found the new request queued with zero pages/body checks. Nothing was manually refreshed or reset; verification completion remains outstanding.

These are two selected leads from the returned truncated queue, not two verified candidates or a market-wide success rate. The prior cohort plan/assessment pins and all original evidence remain intact. Private submission artifacts reside in the original cohort's intake-v1 directory; the journal contains token identities and belongs outside version control. Check existing mint-review status after an uncertain outcome; do not reissue the command to repair or repeat it.

## Operator usage

First export and verify a fresh cohort using [176's commands](176-attention-holder-cohort-readiness.md). Then, from the repository root:

~~~powershell
pnpm exec tsx scripts/discovery-attention-intake.ts .tmp/ORIGINAL_COHORT_DIRECTORY PLAN_FILE_SHA256 ASSESSMENT_FILE_SHA256
~~~

The command reads the existing local operator credential from discovery/.dev.vars. Keep the returned journal and original pins. A nonzero exit or an incomplete acknowledgement count does not prove the request failed to reach the Worker. Do not delete/recreate its journal or reset mint-review state. The existing cached mint-review status is the follow-up authority. A terminal/old token remains held; this command does not widen the current 24-hour migration or creation windows.

## Verification and next work

Targeted intake/artifact regressions passed 13 cases, including 11 new cases. They cover exact authenticated submissions through the real Worker handler, retained-before-send ordering, all-member denominators, no provider calls or quota/candidate writes during submission, no journal reopen, changed pins, stale/future cutoffs, invalid credentials, lost/rejected replies, wrong identities, oversized/extra-field replies, terminal duplicates and mid-batch expiry. The full backend suite passed 1,619 tests / 111 suites. Discovery/app typechecks, closed app build, performance budget (227.8 KiB gzip / 11 startup chunks), security preflight and thesis-only release guard passed. Final hashes, original private-artifact preservation and historical proof/FK checks are recorded in the integrity manifest. No UI change or production CPU/Free-serving certification is claimed. Existing collector proof/quota regressions remain unchanged.

Next, observe these exact requests through normal pacing and account for every terminal/held result before any holder executor. If prominent attention leads are excluded by the old migration-age window, assess a separately versioned older-token research intake using canonical proof and unchanged scoring/action gates; do not reset expired requests or relax current gates to fill the cohort. Continue prospective founder reviews and mature follow-ups, completed-ATTN exclusion authority, larger-holder evidence-format work and [149's Free-serving acceptance](149-native-builder-and-combined-free-budget.md). Production remains thesis-only.
