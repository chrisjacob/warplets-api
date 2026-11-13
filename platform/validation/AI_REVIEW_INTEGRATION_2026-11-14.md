# Durable AI review integration — local validation

New Earn submissions now create a private, durable review obligation in the same database transaction. The Node app exposes owner-only feedback and report-bound appeals. Paid providers remain disabled; only clearly labelled synthetic captures can be evaluated. Existing final scores and rewards are not rescored or changed.

## Implemented

- Migration 070 adds five private tables: jobs, immutable captures, immutable reports, immutable appeals and fenced attempt receipts. It backfills unreviewed submissions only. Submission replay and rollback include the queue obligation.
- Trusted operators capture the exact submission/token/URL and bounded source material. URLs are never fetched automatically. Real captures stay held while providers are disabled.
- A local CLI processes one synthetic job at a time. Live operator grants, SQL-time leases, revision checks and dispatch receipts prevent duplicate or late publication. Dispatched uncertainty is terminal and needs investigation; it is never silently retried or converted to a zero score.
- Signed-in creators can open feedback on demand and appeal the latest suggestion once per report. Request keys survive response loss. A new attempt preserves predecessor and appeal lineage. Final moderation and closed boards prevent new appeals.
- Safe feedback excludes raw source captures and project context. Origin checks, wallet ownership, quotas, bounded UTF-8 bodies and no-store responses protect the HTTP surface. Capture and processing have no public HTTP endpoints.
- The interface separates suggestions from final reviewed scores, retains SIMULATION labels, explains holds, and clears private feedback on session changes. Unsupported runtimes mount no review requests.
- Private recovery preserves all five tables and invalidates running leases. Dispatched work becomes unknown; unstarted work can return to ready. Public recovery excludes these records.
- Schema growth exposed the existing continued-recovery checkpoint ceiling. Lossless private schema packing saves 7,682 bytes while preserving exact SQL comparisons, old checkpoint readers and the unchanged 131,072-byte limit.

## Validation

- 38 AI tests: evaluator/provider mocks, batch/CLI safety, queue concurrency/expiry/rollback, immutable evidence, owner HTTP routes, appeals and private/public recovery.
- Final service follow-up: 14 tests pass, including truthful nested appeal eligibility.
- Node API and actual application workerd compatibility: 2 tests pass.
- Actual D1 queue regression: 2 tests pass, including atomic admission/replay/rollback, lost-response replay, recovery guards/watermarks and absent Worker feedback routes.
- Existing private/public recovery: 9 tests pass.
- Checkpoint format: 4 tests pass, including exact SQL preservation and malformed/ambiguous encoding rejection.
- Continued Node restore: 1,147 steps completed; peak checkpoint 125,333 bytes (5,739 bytes remaining), maximum 13 statements and 107,372 bytes per batch. Complete row reconciliation precedes readiness.
- Frontend: 37 tests, TypeScript and Vite build pass. Actual-API Chromium and WebKit acceptance passes at 320, 390 and 1280 pixels, including submission, feedback, appeal, reconsideration, final score, keyboard focus, private-session cleanup and unsupported-runtime gating.

Exact final CI and local D1 continued-recovery results are recorded in RUN_STATE and MORNING_HANDOFF when complete. Browser evidence and role workflows are in [the user guide](AI_REVIEW_USER_GUIDE_2026-11-14.md).

## Remaining before live AI scoring

1. Approve the real provider/model, data handling and explicit cost/call limits. The standalone opt-in adapter is not enabled in this app queue.
2. Implement trusted text/media capture with provenance, missing-content holds and retention rules.
3. Calibrate the rubric on representative multilingual and adversarial examples. AI is not inherently unbiased; no model-quality claim follows from simulation tests.
4. Decide reviewer staffing, appeal windows, organizational independence and late-correction policy. Separate review attempts currently preserve lineage; they do not prove a different reviewer or model was used.
5. Add the Worker processing/read/appeal adapter, controlled scheduling, operational monitoring and provider-outcome reconciliation. D1 already records durable obligations, but the Worker deliberately does not advertise the Node-only feedback capability.
6. Complete existing release gates before production use. No deployment, funds, transaction broadcasting, subscriptions or external messages were performed.
