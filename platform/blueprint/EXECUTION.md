# Overnight execution instructions

## Authority and operating envelope

The execution run may implement, test, refactor within task boundaries, create local fixtures, prepare review artifacts, and commit/push milestones on the isolated feature branch. Existing project instructions remain authoritative. The founder is unavailable overnight, so routine implementation choices follow this blueprint.

No deployment, remote Cloudflare Worker/D1/R2/KV mutation or resource provisioning, main/dev merge, force push, real token transaction, testnet/devnet funding, private-key retrieval, service purchase, recurring subscription, external message or public marketing publication is authorized. B tasks use local emulation only; do not invoke remote bindings or --remote commands. Preparing disabled adapters is allowed. Connecting a real broadcaster is an R-stage activity.

Optional external reads must be public, free and uncredentialed. Do not consume a paid/metered provider account or retrieve its key. Tests and minimum acceptance use recorded inputs; unavailable live reads are not a blocker to that acceptance. Source-code fetches, official documentation reads and authorized Git pushes remain allowed within tool permissions.

Use installed tools and frozen isolated dependencies first. If a tool requires permission, obey its decision. Do not work around approval review. When a permission or external dependency is unavailable, record the blocked substep and continue an independent offline task. A deadline is not approval.

## Task selection

Read tasks.json and RUN_STATE.json. A task is ready when every dependency is verified and no external gate applies. Choose the earliest priority-ready task, normally the first vertical workflow. Do not jump to optional art, bots, native marketplace trading or a new blockchain because the next repository task is difficult.

B00 is mandatory. B09 can run independently after B00, and B10 after B09. This is useful parallel work while the core storage path progresses. Use at most two active implementation agents by default. Add a reviewer only for a completed boundary that warrants an independent check. The coordinator owns shared contracts, migrations, final staging and pushes.

B20 has two independently recorded acceptance profiles. Run B20-core as soon as B08 and B09 are verified; it does not wait for the collection or financial planning lanes. After core passes, skip B20 entirely until B00–B19 are verified, even though its task state remains in progress. Then run B20-full. A core pass never marks the full profile or entire queue complete. Follow the profile prerequisites in tasks.json. The validator's --next option implements this selection rule and prints compact ready-work records.

A task that cannot finish in one coherent change is split into named substeps under the same ID. Record the next function or test to write. Do not change the dependency graph silently.

## Small context protocol

At startup read README, this file, BASELINE and CONTRACTS. Then load one task card and its named code. Use targeted searches and symbol reads. Read the full PRD only when a referenced requirement is ambiguous.

Keep one paragraph of decisions per task. Store command output in the task evidence directory and summarize failures rather than pasting entire logs. After a context reset, recover from RUN_STATE, the current git diff, and the latest handoff. Never infer completion from a chat summary alone.

Do not repeatedly investigate settled policy or rewrite the plan. Investigate only the specific implementation uncertainty that prevents the next acceptance case. New design choices go into a short decision record with considered alternatives and an observable reason.

## Per task loop

1. Inspect branch, status and the task's named source files. Preserve unrelated user edits.
2. Mark the task in progress with owner and starting commit.
3. Implement the smallest complete vertical change satisfying its contract.
4. Run its focused checks. Repair the cause of failures without weakening the expected product rule.
5. Run broader checks only when the changed boundary warrants them. Pin any new dependency and disable lifecycle scripts.
6. Review the diff for scope, units, provenance, migration compatibility and accidental production bindings.
7. Stage explicit paths, commit the task outcome and push the feature branch. Never stage unrelated files automatically.
8. Record commit, commands, observed results, evidence paths and next step. Mark verified only after actual checks pass.
9. Continue immediately to the next ready task. A progress message is not an invitation to wait for a sleeping founder.

Prefer one commit per reviewable milestone, with a follow-up fix if needed. Do not generate cosmetic commits to simulate progress. If push fails, retain the commit, record the failure, and retry at the next checkpoint without rewriting history.

## Blockers and bounded retries

After a reproducible failure, inspect the relevant state and make a targeted correction. If two materially different fixes fail for the same external uncertainty, write a blocker record and move to another ready task. Do not repeatedly rerun unchanged failing commands.

Record task ID, failed requirement, exact evidence/commit, attempted fixes, smallest next evidence needed, dependent tasks and an alternative ready task. Classify it as implementation defect, missing provider evidence, explicit policy choice, manual device check or permission boundary.

Normal code defects are work to fix, not founder questions. Do not ask the founder to choose table names, repository abstractions, test libraries or formatting. Reserve review questions for changes to economics, authority, real spending, provider commitments, legal release or genuinely incompatible requirements.

If all B tasks are blocked or complete, finish the review packet and stop. Do not use R tasks as a substitute queue. Do not busy-loop, repeat passing suites or invent scope merely to fill the night.

## Checkpoints and interruption

Update RUN_STATE after each milestone and before a large operation. On interruption, leave the exact command/result and next bounded step. Record partially edited files separately from verified work. Do not mark a task complete when code exists but tests have not run.

Before the time/credit limit, reserve one short finalization block. Finish or checkpoint the current change, commit coherent work, push if available, and produce MORNING_HANDOFF.md. Report blockers and limitations honestly. Do not start a new migration or broad refactor in the final block.

## Validation profiles

From the repository root, the installed baseline commands are:

~~~text
node platform/scripts/test-reference.mjs
node platform/contracts/generate.mjs --check
node platform/earn/recovery-drill.mjs
pnpm --dir platform/site build
pnpm --dir platform/site test
pnpm --dir platform/edge typecheck
pnpm --dir platform/edge test
pnpm --dir platform/beacon test
~~~

The reference suite excludes separate site/edge/beacon packages. Do not mistake its pass for a full-stack pass. New cards may add targeted test paths. Use existing browser scripts with locally installed Playwright/Chromium paths. Physical device checks remain manual.

For fresh dependency setup use each package's own pnpm lockfile with frozen-lockfile and ignore-scripts. Do not install the legacy monorepo to test platform-only code. Offline recorded evidence is the default for tests.

CI remains test-only. Update platform/validation/checkpoint.json at an integration checkpoint and inspect the workflow to completion. Do not claim a previous commit's green CI as the changed code's result. Documentation-only commits may reference the exact earlier tested code commit.

## Evidence and morning handoff

Write a compact result JSON per task with taskId, baseCommit, implementationCommit, environment, commands, exitCodes, assertions, fixture/live classification, source digests, unresolved gates and measured costs if any. Redact secrets and private content. Keep large logs outside public manifests.

The morning handoff leads with working behavior, source branch/head and how to run it. Include completed/partial/blocked IDs, test totals by suite, changed contracts/migrations, exact remaining release gates, spending/deployment status and the best next task.
