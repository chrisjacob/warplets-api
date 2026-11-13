# Earn AI review: local evaluation groundwork

This module makes AI-assisted review concrete without silently giving a model authority to finalize rewards. It supplies a versioned rubric, an injectable provider interface, validated evidence-linked feedback, immutable local artifacts and an appeal/review lineage. It does not claim that AI is unbiased.

**Default runtime:** local/offline. The default evaluator is deterministic **simulation**, not an AI model. The app's durable queue hard-disables model providers. A separate, unconnected artifact CLI has a concrete OpenAI Responses adapter requiring an explicit `openai --allow-paid-provider` invocation. No paid request was made during implementation or tests. Content URLs are never fetched and no final review is automatically executed. The queue persists review obligations, captures, suggestions and appeals; it never changes final scores or rewards.

## Durable app queue (local Node only)

Migration `070-ai-review-queue.sql` atomically creates an initial review obligation with every accepted Earn submission. Existing unreviewed submissions are backfilled; already moderated history is not reopened. The local Node app offers authenticated owner-only feedback and report-bound appeal routes; the Worker capability remains absent. A queue entry does **not** mean an AI model has judged the content.

The flow is `awaiting-capture` → `ready` → `running` → `completed` for explicitly synthetic captured fixtures. A trusted local operator supplies the exact submission ID, token, source URL, capture timestamp, content/transcript and project context. The queue never fetches the URL. Real sources can be captured for inspection but enter `held` with provider-disabled evidence. They cannot be evaluated by the deterministic fixture provider. This queue has no flag that enables paid calls.

The creator sees only substantive feedback, the suggested score, uncertainty and appeal status. Raw source captures, provider receipts and prompts stay private. Final moderator scores are displayed separately. An appeal must target the latest completed suggestion, belong to the authenticated creator and use a stable idempotency key; repeating the same request replays its receipt. The previous suggestion remains visible while a new appeal job awaits source capture. New appeals close after final moderation or board closure; an already accepted appeal receipt remains replayable. Re-review adds another immutable report linked to the prior report and appeal, without editing the original or any reward.

`queue-service.mjs` requires an active `app_operator_scopes` grant for scope `ai-review` at capture, acquisition, dispatch and acceptance. It does not trust caller-supplied scopes. Lease tokens, revisions and SQLite execution-time checks fence stale workers. Dispatch intent commits before evaluation. A timeout, late result, revoked operator or interrupted dispatched attempt becomes `unknown`; no automatic retry or zero score is produced. An expired attempt that never dispatched may become ready again. Invalid capture evidence fails before dispatch. Final states and evidence are immutable. Restoring a private snapshot invalidates outstanding leases; it does not authorize a provider replay.

### Local operator commands

Use an existing local database file and a separately provisioned local reviewer grant. The CLI never creates a reviewer grant. For example, trusted setup code can bind the reviewer ID to this SQL statement in the disposable local database:

```sql
INSERT INTO app_operator_scopes(operator,scope,revision,enabled)
VALUES (?,'ai-review',0,1);
```

An initial job ID is `submission:` followed by the accepted submission ID. An appeal job is `appeal:` followed by the appeal ID. Supply a UTF-8 JSON capture file (maximum 128 KiB) using the exact seven fields shown by `exampleJob`, with the **actual accepted** IDs/URL and a capture timestamp between submission and now. Treat captures and the SQLite file as private.

```powershell
node platform/ai-review/queue-cli.mjs capture --database work/review-demo.sqlite --operator-id local-reviewer --job-id submission:SUBMISSION_ID --input work/captured-job.json --evidence-ref local:verified-source-001
node platform/ai-review/queue-cli.mjs run --database work/review-demo.sqlite --operator-id local-reviewer --job-id submission:SUBMISSION_ID
node platform/ai-review/queue-cli.mjs status --database work/review-demo.sqlite --wallet PUBLIC_WALLET --submission-id SUBMISSION_ID
```

`run` processes at most one job per invocation, with a bounded timeout and no retries. Without `--job-id`, it selects the oldest ready job. Run it again to process the next ready job; completed, failed or unknown work is never redispatched. `status` is a trusted local inspection tool, not wallet authentication; browser routes derive the owner from the authenticated session. The command prints only receipt IDs/outcomes or creator-safe status, and rejects model/API-key/paid-provider options.

For automated disposable-database QA, `seedSyntheticReviewQueueFixture(db,{wallet,nowMs,operatorId})` creates labelled synthetic campaign/stake/staffing evidence and a reviewer grant, admits a submission through the real atomic Earn repository, then returns `{submissionId,jobId,job,evidenceRef,operator,principal,nowMs}`. Call `service.capture(f.operator,f)` and `await service.runOne(f.operator,{jobId:f.jobId})` to exercise the actual queue. This helper is explicit test setup, never a production admission bypass or automatic app startup action.

**Still required for real day-one AI scoring:** approved model/cost/privacy settings; trusted source capture and rights/retention rules; calibrated evaluation and adversarial tests; provider-budget controls and unknown-outcome reconciliation; production durable dispatch/runtime integration; and an independent appeal/escalation policy. Simulation is neither real AI nor proof of unbiased judgment. The existing authorized final-review command remains the only route to a final score.

## Quick local review

From the repository root, using installed Node:

```powershell
node platform/ai-review/cli.mjs example --out work/ai-job.json
node platform/ai-review/cli.mjs fixture --input work/ai-job.json --out work/ai-report.json
node platform/ai-review/cli.mjs feedback --input work/ai-report.json --out work/ai-feedback.json
```

Output files are created exclusively: use a new filename for each run. Existing evidence is never overwritten. The example's `.invalid` URL and `SYNTHETIC` label are mandatory for the fixture provider, preventing accidental treatment of a real post as an AI-scored submission.

The QA app may expose `createSyntheticReviewPreview()` from `fixture.mjs` through its explicitly local read-only QA route. This helper evaluates only the fixed synthetic example; it never reads, scores or finalizes wallet submissions. Do not expose a raw report.

The creator view contains an explicitly labelled suggested score, four rubric scores with rationale and actionable improvements, uncertainty, investigation flags and the prior report ID. `creatorFeedback(report)` returns this UI-neutral format; render all strings as plain text. Keep the report itself in private local storage because it retains captured content and context.

## Bounded batches and recovery

`batch.mjs` reviews a captured-job manifest sequentially. Fixture mode is the default; it performs no network calls. Every run requires an explicit `--max-jobs` from 1 to 25, a manifest no larger than 1 MiB, and a **new** output directory whose parent already exists. All jobs are validated before the first provider call. Missing fields, duplicate submission IDs (even with changed content), future captures, excess jobs and existing outputs are rejected upfront.

The manifest has exactly `{"kind":"10x.ai-review-batch.v1","jobs":[job1,job2]}`. Each job uses the same seven captured fields as the single-job CLI. This command creates a three-job synthetic example without overwriting an existing file:

```powershell
node --input-type=module -e "import {exampleJob} from './platform/ai-review/fixture.mjs'; import {writeFileSync} from 'node:fs'; writeFileSync('work/ai-batch.json', JSON.stringify({kind:'10x.ai-review-batch.v1',jobs:[1,2,3].map(n=>({...exampleJob,submissionId:'synthetic-batch-'+n,url:'https://qa.invalid/batch/'+n}))},null,2),{flag:'wx'});"
node platform/ai-review/batch.mjs --input work/ai-batch.json --out work/review-run-001 --max-jobs 3
```

For an approved real-model batch, supply captured jobs and explicit paid consent:

```powershell
node platform/ai-review/batch.mjs --provider openai --allow-paid-provider --model APPROVED_MODEL_ID --input work/captured-batch.json --out work/review-run-002 --max-jobs 10
```

The same private `OPENAI_API_KEY`, optional `OPENAI_REVIEW_MODEL` and `--max-output-tokens` rules apply. The job cap bounds the number of calls, not dollars; there are no automatic retries. Do not run multiple paid batches concurrently without a separate approved aggregate cost limit. Trusted application code may inject a provider with `runBatch({manifest,outputDirectory,maxJobs,provider})`; the default provider is synthetic.

Each output directory contains:

- `manifest.json` and `run.json`: captured inputs, their hash, run ID, provider identity and limits. Keep these private; source text is retained.
- `0001.started.json`, etc.: written before a provider invocation. A started job without a valid report or failure receipt has an **unknown outcome**.
- `0001.report.json` or `0001.failure.json`: an immutable validated suggestion or a safe failure receipt. Provider exception messages, keys and raw response bodies are excluded. Failures do not become zero scores or stop later jobs.
- `summary.json`: ordered outcomes and counts after the whole batch finishes. CLI exit status is 0 when every suggestion was produced, 2 for a completed batch with evaluation failures, and 1 for an input or storage failure.

**Recovery is deliberate:** never rerun into the same directory. Read the saved outcomes and use `verifyReport` before trusting a report. A malformed or missing result after a started marker requires investigation; the provider might already have processed or charged for it. A local storage failure stops immediately and leaves the started marker. Build a new manifest containing only untouched jobs to continue interrupted work. Retry a failed job only after deciding why it failed and accepting any new provider cost. Keep both run directories for lineage. This runner has no cross-run duplicate ledger, automatic resume or production durable queue; filesystem artifacts alone do not prove remote cancellation or power-loss durability.

Batch output never changes the app database, grants operator authority, finalizes scores or settles rewards. Use the existing explicit review/approval flow for each accepted suggestion.

## Rubric and scoring

`10x-content-rubric-v1` uses four 0–5 criteria:

| Criterion | Weight | Focus |
| --- | --- | --- |
| Project relevance | 30% | Help the audience understand the selected project |
| Evidence and accuracy | 30% | Support claims with supplied project context; disclose missing verification |
| Clarity and usefulness | 20% | Explain clearly for the intended audience |
| Thought and craft | 20% | Visible explanation, examples and creative effort |

The host computes `round(sum(criterion score × weight-as-3/3/2/2) / 5)` to obtain the existing integer 0–10 final-review scale. A model cannot supply its own total. Every criterion must include exact captured-text offsets and a matching quote. This establishes grounding in the supplied text, **not the truth of the claims or the authenticity of the model/provider**.

Missing context, unsupported claims, possible duplication, financial promises, harassment, prompt injection, incomplete transcripts and unsupported languages produce investigation flags. Low confidence also holds the suggestion for investigation. A flag is not a finding of wrongdoing. All results—including an unflagged result—require authorized final review.

The prompt omits wallet identity, stake, likes and follower counts. Both content and project context are marked untrusted data. Providers receive no tool instructions, and this module performs no tool execution. Prompt instructions cannot guarantee immunity from model manipulation; strict data validation and preserved operator authorization limit what a manipulated result can do.

## Real OpenAI scoring (explicit paid opt-in)

The concrete adapter uses the Responses API with strict JSON Schema output, `store:false`, no tools, no redirects, no automatic retries, a bounded request/response size and 4,096 output tokens by default. It rejects refusals, incomplete output, missing usage/provenance and unexpected tool output. Completed output still passes the local evidence and business-rule validation. These behaviours follow the [official Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) and [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create), retrieved 13 November 2026.

After approving a model and costs, configure `OPENAI_API_KEY` securely in the local process environment; do not paste it into a report, command argument, repository or browser. Set `OPENAI_REVIEW_MODEL` to the approved model ID, or use `--model`. No model is selected by default.

```powershell
node platform/ai-review/cli.mjs openai --allow-paid-provider --input work/ai-job.json --model APPROVED_MODEL_ID --out work/real-model-report.json
node platform/ai-review/cli.mjs feedback --input work/real-model-report.json --out work/real-model-feedback.json
```

`--max-output-tokens` can set a bound from 512 to 8,192. This is a token bound, not a guaranteed dollar budget. A timeout/refusal may still incur provider charges. `store:false` is not a claim of zero retention; approve the provider/account data policy before sending submitted content. The CLI is single-job and does not supply a cross-process daily budget, retry queue or concurrent output lock. Existing output filenames are refused before making a provider call.

The artifact retains the requested and returned model identity, response/request identifiers and input/output token usage, but never API keys, the provider's raw envelope, hidden reasoning or prompt text. This preserves enough provenance to reconcile an invocation while keeping the creator view concise. The prompt's hash and public version are retained.

## Provider contract and imported model output

A trusted application adapter can call:

```js
const report = await evaluateSubmission({
  job,
  provider: {
    id: 'approved-provider', model: 'pinned-model-id', version: 'approved-config-v1',
    kind: 'model', provenance: 'declared-local-adapter',
    evaluate: async ({systemPrompt, rubricVersion, untrustedData}, {signal}) => {
      // Call the explicitly configured, approved provider; return a JSON object.
      // Apply request/response byte limits and honor AbortSignal in the adapter.
    },
  },
});
```

This interface example supports additional providers. `createOpenAIProvider` in `openai-provider.mjs` is the concrete opt-in implementation; it uses installed Node fetch and needs no SDK install. The wrapper has a bounded timeout and rejects malformed, incomplete, extra-field, wrong-version, unsupported-verification and ungrounded responses. Provider exceptions and timeouts produce no accepted report; they do not become zero scores. Aborting the signal requires adapter cooperation and does not prove a remote provider cancelled work or spending.

The result shape is demonstrated by `report.payload.evaluation` from the fixture run. The provider must return exactly `rubricVersion`, `criteria`, `summary`, `confidence`, `flags`, and `verification`. Criteria have exactly `id`, `score`, `rationale`, `improvement`, `evidence`; evidence has `start`, `end`, `quote`. Offsets use JavaScript UTF-16 positions in the original captured content.

An adapter that supplies a receipt declares `responseFormat: 'evaluation-with-evidence-v1'` and returns `{evaluation, providerEvidence}` from each invocation. `providerEvidence` contains response/request identifiers, resolved model and input/output/total token counts. The OpenAI adapter uses this format: receipt data travels with its evaluation, so concurrent jobs cannot overwrite another job's provenance. An adapter without this format returns the evaluation alone and receives no provider receipt in its report.

For reviewing an already obtained model response offline:

```powershell
node platform/ai-review/cli.mjs import --input work/ai-job.json --response work/model-output.json --provider provider-id --model pinned-model-id --out work/imported-report.json
```

Importing does not call or authenticate a model. Creator feedback explicitly says that imported model provenance is unverified. SHA-256 artifact hashes detect accidental/tampered content changes; they are not digital signatures and cannot authenticate a provider or confer operator authority.

## Authorized final review remains separate

For an unflagged, sufficiently confident suggestion, an operator may explicitly produce an **input draft**:

```powershell
node platform/ai-review/cli.mjs draft --input work/ai-report.json --accept-suggestion --allow-simulation --out work/ai-review-input.json
```

`--allow-simulation` is only for the synthetic local exercise and retains the simulation label. Omit it for actual model reports. Held/investigation reports cannot generate an acceptance draft. To change a held score, investigate and record a fresh reviewed result rather than changing a hashed artifact.

To construct the exact existing operator request envelope, supply a locally obtained current revision snapshot (`{"earn":"…","source":"…","control":"…"}`) and explicit acceptance:

```powershell
node platform/ai-review/cli.mjs request --input work/ai-report.json --revisions work/current-revisions.json --accept-suggestion --allow-simulation --out work/operator-request.json
```

`draftOperatorRequest(report, options)` exposes the same integration for trusted operator code. This produces only a request to preview through the existing console; it does not grant authority or execute it. There is no network or database write in this step.

The input draft supplies `submissionId`, `score`, `reason`, `sourceRef` for the existing `earn.final-review.v1` operation. It **does not** supply a principal, scope grant, expected revisions, confirmation digest or authority. The existing operator session, `earn-review` scope, preview/confirmation, current-state checks and immutable final-review rules must still pass. Stake eligibility, settlement, awards and claims are separate and unchanged.

## Appeals and reconsideration

Create a UTF-8 text file explaining the specific disputed criterion, then:

```powershell
node platform/ai-review/cli.mjs appeal --input work/ai-report.json --reason-file work/appeal.txt --out work/ai-appeal.json
node platform/ai-review/cli.mjs fixture --input work/ai-job.json --previous work/ai-report.json --appeal work/ai-appeal.json --out work/ai-reconsidered.json
```

Appeals retain the original report ID and do not overwrite it. Subsequent reviews must bind the same submission, token and URL, and cannot predate their predecessor/appeal. The CLI creates a local appeal artifact; it does not establish the author's authentication or submit an appeal to a service. **An appeal does not reopen an immutable final review or alter settled rewards.** A production correction/compensation policy remains a launch decision.

## Day-one launch requirements still outstanding

1. Choose and explicitly authorize the real model/provider, pinned configuration, data handling/retention terms and per-day cost/call budget. No paid calls are authorized or made here.
2. Establish trusted capture of the submitted post, media/transcripts and project reference context. A URL alone is not scorable evidence; paywalls, deleted posts and incomplete media need visible holds.
3. Calibrate this provisional rubric against a labelled, multilingual representative set. Measure reviewer/model agreement, repeated-run variability, false flags, identity leakage and adversarial instructions. Compare models blind before selecting one; AI is not inherently neutral.
4. Decide when humans review scores and flags, which complaints need an independent reviewer, and the appeal window. Do not claim scalable autonomous scoring while the final-review scope still requires a human decision.
5. Extend the implemented Node-local durable queue to approved Worker processing, live-provider rate/cost budgets, retained audit evidence and explicit unknown-outcome reconciliation before processing live volume. Local admission obligations, claim fencing, private feedback and idempotent appeals are implemented; paid dispatch and automatic retries remain disabled. The separate artifact CLI is an evaluation tool, not the production scheduler.
6. Agree how late appeals interact with immutable final scores and published settlement. No economic or adjudication policy is silently changed by this module.

## Validation

Run `node --test platform/ai-review/*.test.mjs`. Tests use only local mock transport for the real-provider adapter (zero paid calls). They cover opt-in gating, strict request configuration, refusal/incomplete/error handling, output byte bounds, secret redaction, concurrent receipt isolation, imported provenance labels, deterministic fixture output, rubric arithmetic, evidence validation, extra/forged model output, prompt-injection holds, provider failure and timeout, explicit simulation acceptance, appeal lineage, bounded CLI inputs and overwrite protection. Batch tests cover sequential calls, partial failures with continuation, no retries, duplicate and incomplete input rejection before calls, exclusive outputs, storage-failure recovery markers, bounded UTF-8 input and paid-mode preflight. No real-model quality or bias claims follow from these tests.
