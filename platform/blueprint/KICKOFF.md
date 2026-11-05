# Overnight build kickoff

Paste the following into the next execution conversation from the existing repository workspace.

~~~text
Continue implementing 10X.MEME from the checked-in blueprint at platform/blueprint/README.md.

Use the currently selected GPT-6 Astra High execution profile. The blueprint contains the product decisions and implementation contracts. Do not restart the PRD or rebuild working local modules.

Read platform/blueprint/EXECUTION.md, BASELINE.md and CONTRACTS.md. Run node platform/blueprint/validate-plan.mjs --next for the compact queue/state view; inspect tasks.json and RUN_STATE.json as needed. Verify the current checkout rather than resetting to the recorded baseline. Begin with B00 if unverified, then work through dependency-ready tasks. Prioritize the coherent D1 Earn workflow through R2 publication and recovery. Use B09/B10 as independent frontend work where useful. After B20-core passes, skip B20 until its full prerequisites are verified.

Work independently while I sleep. Resolve routine engineering choices from the blueprint, record new decisions, and continue with other ready work when a provider, approval or manual device check blocks one task. Do not stop to ask broad questions or offer to continue. Keep exact resumable state after each milestone and context reset.

Commit and push each completed, tested milestone to the isolated feature branch. Preserve unrelated changes and existing Warplets, Stonklets and Network production resources. Do not force-push, merge main/dev, deploy, mutate/provision remote Cloudflare resources, spend money, fund wallets, broadcast transactions, create subscriptions or send external messages. Real financial capabilities remain disabled. Do not bypass any approval or safety boundary.

Prefer existing pinned dependencies, local workerd/D1/R2 and recorded evidence. Optional external reads must be public, free and uncredentialed; never use a metered account or provider key. Do not relabel fixtures as live chain observations. Follow the task's acceptance cases, and never weaken assertions just to obtain green tests. Run B20-core when its own prerequisites pass; do not wait for B20-full or imply that core acceptance completes the entire product.

Use small task-sized context. At most two implementation agents should run by default, with one owner for contracts/migrations and commits. Run focused tests per change and full integration checks at genuine milestones.

Continue until the available run budget ends, the B queue is complete, or all remaining tasks are externally blocked. Before stopping, commit coherent work, push when available, update RUN_STATE.json and write platform/blueprint/MORNING_HANDOFF.md with results, source commits, test evidence, remaining gates, and the next exact action. Do not begin R-stage release work without my later authorization.
~~~

The next run reads its authorization from the actual user message above. This file is a reusable prompt, not an automation, scheduled job, background deployment or permission grant on its own.
