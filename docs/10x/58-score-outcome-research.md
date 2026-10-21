# Prospective score observations and outcome research

Implementation plan, 21 October 2026. PRD v1.2 §§4.7, 11.8 and 15.1 require retaining versioned score inputs before evaluating outcomes. The existing observation, recommendation, wallet and diagnostic cohorts predate the score model and must not be retroactively graded or rewritten.

1. Retain the first captured scorecard per mint/model version, including its exact policy, inputs, observation time, evidence coverage, independent action status and available baseline. Capture recent live creations across all action statuses, in first-seen/address order rather than selecting only high scores or successful tokens. Never backdate a capture or substitute a later improved score.
2. Use the existing local maintenance timer: at most three capture attempts and five matured outcomes per minute, with pause checks and an owned two-minute lease checked again at publication. Cap all new cohort storage at 100 records and 10 MB per UTC day; fail or report bounds instead of truncating inputs. No new provider call, collection priority, source allowance, schedule or remote resource.
3. Finalize once after the full 24h target plus two-hour endpoint grace. Require a fresh baseline and comparable same-source price/liquidity endpoint; retain at most 256 lightweight endpoint observations, with explicit gaps for incomplete, duplicate, future or oversized histories. Freeze both the selected endpoint and the input series for offline replay. Missing observations are insufficient data, never a zero return or a fraud finding.
4. Publish a bounded research view with original score/coverage, pending/measured/insufficient counts and descriptive score-band outcome counts. Expose immutable cohort/outcome JSON and offline replay. Distinguish sampled severe declines from established scams. Do not claim predictive calibration, investment performance, a causal effect or independent organic activity; no automatic model or policy activation.
5. Test immutability, exact replay/tamper rejection, outcome timing/source/zero-value cases, resource caps, duplicate delivery, pause/lease races and publication atomicity. Validate the local preview, existing regressions, build and source-free health checks; update progress docs and commit/push. No deploy.

This is prospective retention and descriptive measurement, not a trained model or a validated ranking rule. Chronological holdout analysis, adequate mature coverage, selection/missingness assessment and independently verified outcomes remain later work. Existing score-v1/election replay, financial restrictions and unrelated Network work remain unchanged.

## Implemented behavior

Subsequent collection correction: [bounded score endpoint follow-up](59-score-endpoint-followup.md) adds age-expired cohort targets to spare slots in ordinary market batches. This original retention milestone did not itself continue market observation after candidate expiry. Follow-up still needs a usable frozen baseline and matching provider, and never freshens an expired candidate or changes a frozen score/outcome.

Local migration `0037_score_research.sql` adds separate cohorts, outcomes, attempts and owned control state. Ordinary maintenance now calls the cached research cycle. Cohorts are keyed by mint/model and insert only once; capture and its stable audit commit together through a [D1 transactional batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Count/byte admission and pause/lease ownership are checked by the publication SQL. A worker that loses its lease cannot publish, clear its replacement's lease or report success. Snapshots more than two minutes old cannot be published as new captures, and no missed-day backfill occurs.

Capture examines at most three current live creations per tick, including excluded and provisional tokens. It orders never-attempted tokens first, then prior attempt time, first-seen time and address; this bounded sample is not random. Candidate payloads above 1.6 MB and score inputs above 1.8 MB fail explicitly, with a final 1.9 MB cohort bound. Unknown/stale market data is still retained with its original score; it supplies no fresh outcome baseline. Future evidence is not admitted. No current score, historical cohort, archived token, election record or collection priority is rewritten.

The v1 cohort evaluator pins the original `discovery-local-v3` action-label policy independently of future defaults. New full artifacts also include that exact policy. Early local captures without the optional policy copy remain valid against the same frozen v3 definition; their inputs and checksums are not rewritten. This diagnostic label never grants voting/launch authority. Preserve the v1 action assessment semantics when adding a later evaluator.

Outcome collection uses one address-scoped cached query per matured token, restricted to target minus 30 minutes through target plus two hours. It reads at most 257 lightweight rows: more than 256 withholds measurement and retains the explicit limited-series marker. Otherwise the nearest acceptable same-provider endpoint is chosen, with an earlier timestamp winning equal-distance ties. Duplicate instants (including differently formatted equal timestamps), observations after fetch time and out-of-window points are excluded with gaps. Reported zero endpoints can measure a 100% decline; zero/missing baseline denominators and nonfinite derived returns remain unavailable. Both finite price and liquidity comparisons are required for a measured outcome. Finalization is insert-once after the complete 26-hour window; later observations never silently replace it.

`GET /api/10x/research/scores` returns the latest **500** compact, checksum-verified cohort/outcome summaries and five descriptive score bands, with capped-view, pending and insufficient counts visible. The query removes scorecard and endpoint-series inputs before returning database rows; it does not materialize 500 complete archives in the Worker. It verifies result/metadata hashes, timing and cohort identity, rather than claiming full input replay from that projection. `GET /api/10x/research/scores/solana/:address` replays the complete retained scorecard and outcome inputs. Input/result/metadata hashes establish reproducibility, not issuer authentication or independent completeness/truth of source data. Preserve these v1 definitions when introducing later versions.

The Research page shows original grade/coverage, independent action status, prospective timestamps, exact evidence links and later outcome status. It explains storage/coverage selection bias and keeps descriptive bands separate from trust labels or prediction claims. Existing daily filter proposals and warning-signal research remain separate.

## Local evidence and checks

The existing timer captured **six** prospective scorecards by **2026-10-21T01:35:59Z**, occupying **121,884 bytes**; all six were pending with zero measured or insufficient outcomes and no research error. The latest record then was `7nr7CQURUav5zvrEZGdg3BwgKyqx4owgqiN9n9rdpump`, score **72**, cohort checksum `ab23a4614136d234d9a34d85711a1434bfe86ae033f21afd1f13969cebaa9aa1`. Cached detail replay verified. Browser QA later showed nine pending records, exact evidence links and descriptive-band controls. These counts are dated observations, not a calibration result.

Thirty new backend tests cover replay/tampering, pinned action-policy and early-artifact compatibility, all-status sampling, stale/missing/future baselines, exact grace/tie behavior, zero endpoints, source/duplicate/window gaps, overflow, immutable publication, atomic audit rollback, daily caps, capture/finalization bounds, source-free APIs and pause/expiry/replacement races. Four UI tests cover empty/pending/insufficient/measured presentation, exact evidence links, storage bounds and stale refreshes.

At **01:40:07Z**, normal maintenance had retained **12** original grades (**194,870 bytes**), all pending, with no research error. The latest exported artifact replayed offline: mint `E5jXJfMdmdqGRKAo8cUeFZDC9RBr5KvpES74J1LQpump`, captured **01:39:34.651Z**, score **7**, effective coverage **10%**, cohort checksum `b415a42a268235d3ad2a9cf699f01ac9aa12d39ec0458b40e1a3028bb6ffa4b1`. Low coverage is retained as observed; no mature live score outcomes are claimed.

Final validation passed **828 backend tests across 51 files**, **71 discovery UI tests across 13 files**, backend typecheck, App typecheck/build and the unchanged home startup budget (**234.1 KiB gzip / 11 chunks**, below 250 KiB). OpenAPI now describes **93 paths**. The original `457bce8c…` scorecard and an early research artifact without the optional action-policy copy still replayed, as did three retained election records including the 442-input daily rehearsal. No score/election engine or active gate changed.

At **01:43:31Z**, there were **18 captured / 18 pending / 0 measured / 0 insufficient** records using **269,049 bytes**, with no score-research error. Final offline replay verified the latest artifact (`FfQLmBxE87iZVg4Q7SL5JDduRJiGZ9k696cy937Spump`, **01:42:34.828Z**, score **7**, coverage **10%**, cohort hash `5979381dd25febc83b1a94b6541e77389aea42e72bfc3f10bd3b3d5ac8606c50`). Cached Discover ranked **71** recent observations, action counts **0 eligible / 9 provisional / 62 excluded**. The independent watchdog was fresh, with no restart recommended or election error; operations was degraded by `market_source_issue`. Source backoff/quotas were left intact. Verification made zero provider calls; the local workstation must remain awake for later outcome collection.

Commands (repository root unless noted):

```powershell
# From discovery/, preserved local store only:
pnpm exec wrangler d1 migrations apply TENX_DB --local --config wrangler.local.jsonc --persist-to .wrangler/local
# From repository root:
pnpm --dir discovery test
pnpm --dir discovery typecheck
pnpm --dir app test src/discovery
pnpm --dir app build
node node_modules/tsx/dist/cli.mjs scripts/generate-discovery-openapi.ts
node node_modules/tsx/dist/cli.mjs scripts/check-score-research.ts
node node_modules/tsx/dist/cli.mjs scripts/verify-score-research.ts .tmp/score-research-local.json
node node_modules/tsx/dist/cli.mjs scripts/check-discovery-scores.ts
node node_modules/tsx/dist/cli.mjs scripts/check-discovery-operations.ts
git diff --check
```

No new environment setting, paid source, financial permission, remote resource or deployment is introduced. These local CPU/storage checks do not certify future remote free-tier capacity. Long-term archival/restore and mature time-separated outcome analysis remain open.
