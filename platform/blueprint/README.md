# 10X MEME implementation blueprint

Turn the existing local product into a coherent Cloudflare implementation without deploying it or moving funds. The next overnight run should finish a verified vertical workflow before expanding the feature surface. This pack specifies the remaining implementation, preserves the founder's settled rules, and provides a resumable work queue.

Prepared 5 November 2026 in Australia/Sydney. Governing product specification is [PRD 1.2](../spec/10X_MEME_PRD_v1_2.docx), with [searchable source](../spec/prd-v1.2-source.txt). Inspected implementation head is **5f3cafffc08d2404976ea14532dad2d2751cffcd**, branch **work/10x-prd-foundation**, repository **chrisjacob/warplets-api**. Product code starts from released main ec052a0. These are starting observations, not instructions to reset a newer checkout.

The founder selected GPT-6 Astra High for the later execution run. This blueprint does not require model-specific behavior, automatic model switching or a claim about token pricing. Smaller task files, stable interfaces and explicit checks reduce repeated investigation.

## Start here

1. Read [execution instructions](EXECUTION.md) and [policy and architecture](CONTRACTS.md) once.
2. Read [the current baseline](BASELINE.md). Reuse the working implementations it identifies.
3. Select the first dependency-ready task from [tasks.json](tasks.json). Read that task file and only its named sources.
4. Update [run state](RUN_STATE.json) as work progresses. Store evidence under platform/validation/runs/RUN_ID/.
5. Use [the kickoff prompt](KICKOFF.md) to start the overnight conversation. It preserves the current no-deployment boundary.
6. Read [release gates](RELEASE_GATES.md) when a task reaches a protocol, financial, provider or physical-device dependency.

For a compact view after a context reset, run `node platform/blueprint/validate-plan.mjs --next` from the repository root. It validates the pack and shows ready tasks without dumping the entire manifest. Use `--self-check` to verify the core/full checkpoint selection rules. Update RUN_STATE only with observed progress; its initial state intentionally says no new B task has started.

All task paths are relative to the repository root. Proposed paths are explicitly marked. Task IDs are permanent references for handoffs, dependency checks and acceptance evidence.

## First overnight objective

The minimum coherent result is a locally runnable Cloudflare Earn workflow: authenticated submission, capacity enforcement, final human moderation, exact-cutoff recorded evidence, deterministic global settlement, immutable award publication, R2 retrieval and restore. Its results must match the existing Node reference service.

The core dependency chain is **B00 → B01 → B02 → {B03, B04} → B05 → B06 → B07 → B08 → B20-core**. B09, which can run after B00, is also required by B20-core for capability-aware browser acceptance. B04 and B05 use recorded evidence by default, so provider access cannot stop this path. A later live read adapter must satisfy the same contract. B10 can follow B09 independently of backend work.

Finish and verify the chain as far as the run permits. Do not promise that the whole product or even this chain will fit in one night. If time is short, stop at the last complete task with its next precise action recorded. Keep uncompleted dependencies visible.

## Full sequence

| Stage | Tasks | Concrete result |
| --- | --- | --- |
| Preserve and extract | B00–B02 | Verified starting point, portable service boundaries and atomic SQLite/D1 repositories |
| Make execution resumable | B03–B05 | Fenced jobs, provenance-aware read evidence and explicit cutoff completeness |
| Finish the first vertical workflow | B06–B08 | D1 Earn admission/moderation/settlement and portable R2 awards |
| Complete the product experience | B09–B11 | Runtime-aware frontend, complete collection disclosures and D1 collection requests |
| Complete operations | B12–B13 | Scoped local administration, consent, usage, audit and recovery |
| Prepare financial integrations | B14–B16 | Verified read-only quotes, unsigned local action plans and complete cost packets |
| Finish NFT support surfaces | B17–B19 | Fairness/metadata state machines, marketplace and wallet compatibility packet, financial gate dossier |
| Verify the combined system | B20-core, then B20-full | First the independent Earn workflow; later all implemented lanes, restore, budgets and browser evidence |
| Release only after separate authorization | R01–R06 | Reviewed custody and funded protocol choices, real fulfillment, staffed pilot, then scale |

B tasks are implementation work that can proceed offline under existing authorization. Only public, free, uncredentialed external reads are optional; no paid/metered access or remote Cloudflare writes are part of this run. R tasks are future gated releases, not authority for an unattended mainnet run. B20-core can pass while B10–B19 remain unfinished; B20 as a whole is verified only when B20-full passes.

## Definition of a completed task

A task is complete only when its specified behavior exists, relevant tests pass, changes and evidence are committed, the milestone is pushed when available, and RUN_STATE records the result. A passing fixture is recorded as fixture evidence. A candidate protocol remains a candidate until its release gates pass. No task may advertise a production capability by changing a flag alone.

## Decisions preserved

Actual activation starts token clocks. The 80/10/5/2.5/2.5 split, Vault → Stake → Earn order, new Solana Genesis, permanent historical claims, global Top 100, final moderation, advisory ASAP/7/14/30 voting and per-stage mint limits are fixed. No NFT burn action is introduced. Warplets Base, Stonklets maintenance and the released Network remain outside this implementation.

The Sydney launch window and later mint prices remain unset. Existing UTC board mapping and day-eleven Earn vesting remain implementation proposals documented in the PRD. Preserve their versioned local behavior while building; obtain explicit release ratification before funding it.

## Review outputs

The [acceptance traceability table](TRACEABILITY.md) maps all 58 PRD cases to existing evidence, B work and future release verification. The supporting designs give the detailed [storage/Earn algorithms](design/storage-earn.md), [product/collection interfaces](design/product-collections.md) and [financial planning contracts](design/financial-gates.md). Load only the section named by the current task.

The [blueprint review record](VALIDATION.md) lists checks performed on this pack and their limits. It is separate from execution evidence generated by the next run.

The next run should leave a working local preview, updated task state, a short morning handoff, source and evidence commits, exact test results, and a list of concrete blocked release decisions. It should not leave an unreviewed deployment, purchased service, pending wallet payment, automatic publishing job or changed legacy production binding.
