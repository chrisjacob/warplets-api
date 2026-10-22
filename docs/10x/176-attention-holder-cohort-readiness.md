# Fix a holder-study cohort before inspecting readiness

23 October 2026, Australia/Sydney. Continues [175](175-attention-holder-evidence-disclosure.md). No deploy.

## Delivered

- [x] Add a versioned, hash-bound research policy selecting at most three Solana identities from the frozen returned attention queue. Slots are the first fresh result without a queue-adverse flag, the first fresh provider-adverse control, and a distinct fresh result at original queue position 11 or later. Preserve source ordering and exact chain/contract identity. A missing stratum stays empty; no fallback, substitution or reranking after readiness is observed.
- [x] Retain returned-view, chain, fresh/stale, provider-adverse, selected/unselected and truncation denominators. Equal symbols are distinct identities. Multiple windows from a provider do not become independent attention votes. Reject duplicate identities/windows, future source times, incorrect freshness/family counts and oversized source projections. Non-adverse does not mean safe; adverse is a provider concern, not a verified negative outcome. Personal familiarity and meme relevance remain unknown.
- [x] Add private CLI export using a read-only SQLite connection and a consistent read transaction. Replay the existing bounded attention receipts, then exclusively write the exact policy/source/selection before querying candidate readiness. Read only the selected candidate records in one query, projecting bodies over the existing 1.6 MB candidate bound as null. A later failure preserves the original plan; an existing output directory cannot be reopened or overwritten.
- [x] Report missing, oversized, corrupt, mismatched or after-cutoff candidate records, missing creation/graduation references, missing/late migration leads and conflicts with the unchanged current quality screens. Include every selected member in the result. A recorded-field match is not proof replay or admission: canonical migration/state verification, current top-ten scheduling, shared control/quota checks and original evidence gates still apply.
- [x] Separate conditional snapshot-work reference cost from unknown intake, wallet and full qualification costs. The existing isolated holder cycle can use at most four RPC calls for cluster/state/inventory/mint-state work after its migration admission; two observations for each of three members would reference 24 calls. This is not a reservation, proposed extra allowance or guarantee of useful data. Intake and wallet completion remain unknown, so total qualification cost and Free-budget admission remain held.
- [x] Add independently pinned verification of both private artifacts, recomputing selection and readiness exactly. Reject altered policy/selection/envelopes, report changes and changed pins. These hashes protect local artifact integrity; they are not provider authentication, external preregistration or trusted-time evidence.

There is no Worker route, timer, collector dispatch, candidate insertion, quota/backoff reset, runtime adoption or score/action effect. The output always declares `rpc_dispatch_allowed=false` and `free_budget_admitted=false`. A new plan or cutoff is a research observation, not a retry permit. Personal notes, collector policies, qualification/report formats and production exposure are unchanged.

## Local assessment

At 19:21 UTC on 22 October, the ordinary export used cutoff `2026-10-22T19:21:45.390Z`. The returned view contained 100 tokens: 34 Solana and 66 other-chain identities. All 34 Solana observations were fresh in that view; no queue-adverse Solana member was present. The fixed slots selected original positions 1 and 11, left the adverse-control slot empty and retained 32 unselected fresh Solana identities. The view was truncated and the completed-launch registry remained disconnected.

Both selected members lacked a saved candidate and an at-cutoff migration lead; neither matched the recorded quality fields. This identifies an intake gap for these two leads, not a market-wide rate or proof that the market lacks good memes. The conditional paired-inventory reference is 16 calls, but intake, wallet and total qualification costs remain unknown and Free-budget admission is false. No source request, database write or dispatch occurred.

Both files replayed exactly. Plan-file SHA-256: `63340d7d2130f70cb460154124f2604aa2c42599c970dc8433f39377bc1302bb`; assessment-file SHA-256: `2553247bf844ddd1c0307c54d423dcfe9dc6fb1cc8a6e81b965635f9ea25657c`. Selection was retained before candidate readiness; these pins protect local artifacts, not independently attested source truth. Keep synthetic controls separate from these ordinary local observations.

## Operator usage

From the repository root, use an exact canonical cutoff and a new directory beneath `.tmp`:

```powershell
pnpm exec tsx scripts/discovery-attention-holder-cohort.ts export LOCAL_SQLITE CANONICAL_ISO_CUTOFF .tmp/NEW_PRIVATE_DIRECTORY
pnpm exec tsx scripts/discovery-attention-holder-cohort.ts verify .tmp/NEW_PRIVATE_DIRECTORY PLAN_FILE_SHA256 ASSESSMENT_FILE_SHA256
```

Retain both printed file pins separately. `plan.json` contains the original bounded queue projection and policy; `assessment.json` contains the selected metadata and report. They can contain source/token details and belong in ignored private evidence, not public notes. Export/verify makes no provider call and cannot collect anything. If an export fails after retaining its plan, keep that file; do not reuse the directory to repair or replace it. The connection's read-only/query-only protections prevent source writes; test scratch databases are separate.

## Verification and next work

The full backend suite passed 1,608 tests / 110 suites, including 12 new planner/CLI cases. Final targeted planner/CLI regressions passed 12 cases after correcting the readonly tamper-test construction. Both typechecks, the closed build, performance budget (227.8 KiB gzip / 11 startup chunks), thesis-only release guard and security preflight passed. Historical proof/private-artifact preservation is checked before commit. Current Workers guidance and published types 5.20261022.1 were checked; no configuration/dependency upgrade was made. Tests cover source-independent selection, no fallback, exact denominators, stale/unsupported inputs, source integrity, held members, unknown total cost, SQL transfer bounds, no writes, exclusive output, pinned replay/tamper rejection and retained-plan failure behavior. Native CLI work does not certify production Workers CPU or shared Free serving.

Next, design the verified intake bridge for these frozen attention leads before a holder executor. The attention union does not currently guarantee an archived candidate/migration, so calling the existing quality cycle alone cannot cover this cohort. Any executor needs a separate original-plan journal, unchanged provider/global/subset quotas and source/lease/pause/backoff/day controls, no reopening spent work, and complete source/migration/state admission before holder qualification. Do not loosen age/liquidity or evidence gates merely to fill this cohort; assess a separately versioned research intake if older attention leads need it. Continue real prospective founder reviews and mature follow-ups, completed-ATTN exclusion authority, the larger-holder evidence-format assessment and [149's serving acceptance](149-native-builder-and-combined-free-budget.md). Production remains thesis-only. No deploy.
