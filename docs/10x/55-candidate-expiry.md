# Expire old candidates while retaining their history

Implemented 21 October 2026 (Australia/Sydney), following PRD §§4.4 (expire outside the creation window while retaining history), 12 (retention/archival) and 17.1 (bounded active discovery). Local only; no deployment or financial capability change.

## Behavior and scope

The local inventory had 442 candidates, including 194 with creation dates older than 24 hours and 176 with unknown creation dates. Keeping every historical token in future election inputs would eventually encounter the unchanged 500-input rehearsal guard.

Migration `0035_candidate_expiry.sql` adds a logical expiry ledger and an active-candidate view. It deletes and moves no candidate, transaction, account, holder, wallet, price, outcome, cohort or rehearsal record. Historical token links keep working. This is active-inventory lifecycle management; long-term storage compaction and archival/restore remain open.

- Normal local maintenance expires at most **20** live candidates per tick, strictly **after** 24 hours from creation. Exactly 24 hours remains inside the existing gate.
- The candidate's complete creation proof must match its independently retained creation-proof row. Missing, mismatched, future or unknown dates cannot cause expiry. Proofs over **8,192 UTF-8 bytes** remain active rather than expanding the bounded write input. Fixture rows are isolated.
- Each receipt records `verified-creation-expiry-v1`, address, the original creation proof and actual expiry observation time, plus its SHA-256. SQL blocks updates/deletes and checks the proof relationship on admission.
- A two-statement [D1 transaction batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) records all admitted receipts and their matching audit events together. Pause and the current proof are checked again inside the write. Unique address receipts settle overlapping ticks; the losing attempt cannot replace the original timestamp or audit hash. Failed audits roll back the whole tick.
- This maintenance makes **zero provider requests**, reserves no quota and changes no source lease, pacing, backoff, source allowance or evidence timestamp. Pause blocks new expiry writes.
- Active collection planning/coverage and newly created election, policy-preview and backing-opening inventories use the active view. Expired migration leads are not requeued for ordinary inspection. Later candidate saves cannot reactivate an expired address.
- Existing frozen records retain their exact original inputs, portable v1 schemas, hashes and replay engines. Historical backing cutoff reads still have their candidate rows. Research baselines, market/outcome history and evidence references remain intact.
- The **500 active-candidate input guard** and **100 eligible-shortlist cap** remain. An oversized active inventory still holds new rehearsals instead of silently trimming it. Unknown-date accumulation can still reach that guard; it requires better evidence or a separately justified lifecycle policy.

Discover's existing **All stored observations** option continues to include retained history through its bounded inventory/list view; it is not an exhaustive archive browser. Individual token pages remain directly addressable. Past tokens get an explicit history/staleness notice and expandable expiry proof/checksum. Data status shows retained, active and expired counts and the active-cap warning. The ten-recent-eligible-token goal and every eligibility gate remain unchanged.

## Local evidence

The migration was applied with pinned Wrangler 4.126.0 using `--local --persist-to .wrangler/local --config wrangler.local.jsonc` in Discovery. No remote migration was used. The first ordinary tick at **2026-10-21T00:36:51.211Z** expired 20 candidates without forcing collection.

At **00:40:12Z**, the store held **442 retained / 362 active / 80 expired** candidates, with **0/10 eligible**, 72 verified creation dates within 24h and 176 unknown creation dates. Remaining old candidates continue through normal bounded ticks. An example retained detail page is [this expired token](https://app-local.10x.meme/token/solana/266xwt1he2DtB39LFahETEokivhN6VaBgUage7xBpump), with receipt `9d93c878dac9792c95a9293d6fb939ec2d001f74149dc432f5e815604668c333`.

The cached operations check replayed all **442** original inputs for `daily-2026-10-21` (1,637,981 bytes) and two older manual records after expiry. The daily record still reports **0 eligible / 13 provisional / 429 excluded**; its existing hashes were not rewritten. The independent watchdog was fresh and recommended no restart. Current market/wallet source issues remain visible.

Kimchi `CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump` remains scanning, with one replayed signature page, five intake reservations and no certified migration/candidate at this checkpoint. Expiry provides no new safety, eligibility, original/copycat or non-WSOL certification claim.

## Validation and remaining work

- Discovery: **750 tests / 48 files** passed; the nine expiry tests passed again after the proof byte bound. Cases cover exact age boundary, unresolved/future/fixture/mismatched/oversized evidence, bounded draining, pause between read/write, concurrent receipts, atomic rollback, immutable receipts, retained details/cohorts/elections, later saves and the 502-to-500 active-inventory boundary.
- UI: **60 tests / 10 files** passed, including past-token and active-cap disclosures. Discovery typecheck passed.
- Cached local checks verified the real expiry receipt/hash and preserved token detail, three old election replays, Kimchi intake, 15 private-path denials and ten admin security checks, with zero provider requests.
- Browser QA on the existing preview confirmed Data status counts and the retained token's history/staleness notice. OpenAPI was regenerated from runtime schemas; no endpoint was added.
- App typecheck/build and startup-budget check passed: **234.1 KiB gzip / 11 home chunks**, below the unchanged 250 KiB budget. OpenAPI remains at 89 paths. `git diff --check` passed.

Read-only check (optionally pass an already expired mint):

```powershell
node node_modules/tsx/dist/cli.mjs scripts/check-discovery-inventory.ts 266xwt1he2DtB39LFahETEokivhN6VaBgUage7xBpump
```

Next: improve source-complete recent-token and Kimchi evidence within existing allowances, certify supported non-WSOL migrations separately, and address unknown-date growth and long-term storage with explicit history-preservation semantics. Ten eligible recent tokens, real-wallet/small-screen/assistive-technology QA and provider credential rotation remain open. No deployment, paid service, policy activation or financial execution was introduced.
