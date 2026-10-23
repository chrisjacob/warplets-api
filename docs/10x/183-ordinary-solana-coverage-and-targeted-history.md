# Ordinary Solana coverage and future-cohort historical targeting

23 October 2026, Australia/Sydney. Continues [182](182-solana-crosscheck-hour-allocation.md). No deploy.

## Ordinary coverage verification

Only the existing workstation timer dispatches collection. Engineering audits use consistent read-only transactions and fresh exclusive private filenames, with no provider requests, forced refresh, new timer, spent-hour replacement or database writes.

The **07:21:57 UTC** snapshot verifies the original 07:00 BSC reservation at 07:08:40: 20 requested / 20 distinct returned, including 13 reported older targets. Original request/receipt/response hashes and the exact v2 scheduler replay match. The returned view has 39 Solana identities and zero fresh cross-checks; candle/trader selection is correctly held. The 06:00 Robinhood slot predates checkpoint 182 and remains spent.

Initial private inputs: `.tmp/ordinary-coverage-183-001/inputs.json`, SHA-256 `332b4522ce3d85c7704267803d834dd1d249598abd99eb163f3dc8ffc9bdaf94`; result SHA-256 `b9282a3113b6e6fbc17eb70cdc1eeb83066353f8119874ca203927d7999e99fd`. Hashes establish local integrity, not independent provider authenticity. Reported opening age remains distinct from proven creation/graduation age. Bounded views disclose truncation.

The first protected post-change Solana hour succeeds naturally at **08:02:40 UTC**: **20 requested / 20 distinct returned**, including 11 reported older targets. Original hashes and the exact v2 scheduler replay match. The consistent **08:04:06 UTC** snapshot has **37 returned Solana identities / 20 fresh cross-checks**, with candle/trader targets available again. No new candle/trader receipt or v2 canonical/history result is retained by that cutoff. This demonstrates recovery in one protected hour, alongside the preceding other-chain allocation; repeated protected-hour freshness, downstream acquisition and live targeted-history proof success remain unverified. Snapshot composition changed, so 39-to-37 is not an outcome/retention measure.

Final private inputs: `.tmp/ordinary-coverage-183-002/inputs.json`, SHA-256 `ed6d3269faa215ae3f714532a9d0ba2a29efbe1da11964f85d19283ac8b81613`; result SHA-256 `39cfbcad9af2e8d37b9244918d33785fa0f679c2cc87fefce6723c582fc69044`. A separate file-only process replays both successful ordinary allocations and original receipt hashes. At this cutoff, usage is 204/600 market, 360/1,800 quality and 984/5,000 global RPC. These are current cumulative counters, not cost attributable solely to this change; no reset or additional allowance. The original historical cost remains 13 charged attempts, with the failed third turn untouched.

## Future-cohort target policy

New ordinary canonical intakes retain `canonical-attention-intake-v2` and the `attention-historical-targeting-v2` policy hash before RPC. This immutable cohort marker applies only to new original intake records. Existing canonical intakes retain v1 behavior. Any previously attempted mint, terminal history, failed turn, uncertain dispatch or incomplete receipt remains spent; no mint reset or reinterpretation under v2.

For those future cohorts, derive lookup hints from the replayed canonical identity:

| Event sought | Lookup address | What can prove the event |
|---|---|---|
| Migration | Canonical PumpSwap LP-mint PDA: AMM seeds `pool_lp_mint`, canonical pool | Existing successful exact Pump migration instruction plus correctly nested canonical PumpSwap pool creation; every original state identity field must match |
| Classic-token creation | Metaplex metadata PDA: metadata-program seeds `metadata`, metadata program, mint | Existing successful exact Pump `create` validator, canonical mint/curve/authority and actual instruction metadata |
| Token-2022 creation | Original mint | Existing successful exact Pump `create_v2` validator; no separate metadata account is assumed |

The seeds/account layouts were checked against the already pinned Pump public-docs revision `639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22`: [PumpSwap IDL](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/idl/pump_amm.json), [Pump IDL](https://github.com/pump-fun/pump-public-docs/blob/639b87fb45c3adeffa6f7c4a1bf0cb85e392bf22/idl/pump.json). The protocol verifier/schema is unchanged. LP/metadata addresses are expected to be quieter than swap/curve addresses because they serve different instructions; this is a targeting rationale, not measured live page density or a guarantee of finding either event. Token-2022 mint history can still be busy.

A file-only derivation check also matches the new LP target against the actual LP field in the single previously frozen canonical pool account. This checks the address recipe against retained RPC bytes, without querying that original mint's history, retrying its failed turn or proving an event. Private result `.tmp/target-derivation-consistency-183-001.json`, SHA-256 `e686b74a5b06dd809a91f43abf9b86952386d335bc7b932b801a36893be54c3a`.

Start with the LP-mint target. If its original full page lacks migration proof, continue only its original cursor. After migration is found, or that target's page is short, inspect the missing creation target. The distinct target begins with its own first page and no LP cursor. Continue creation only while its original page is full and origin remains unknown. Stop on a verified pair, terminal unknown, any original failure or the unchanged three-page total. No return to an exhausted target or fallback after transport failure.

Each plan freezes target kind/address, source canonical receipt/intake-plan hashes, state slot/time, parent hash, target-scoped original cursor and policy hash before RPC. A page can overlap another target's signatures; previously inspected bodies, including missing bodies, are never fetched again. Same-target duplicate/overlapping pages still fail. Every returned body must reference the requested lookup address in static/loaded account keys and retain exact signature, slot, success, page/transaction time, state cutoff and creation-before-migration checks. Address membership alone supplies no proof: unrelated metadata updates remain unknown.

## Limits and preservation

Reuse the existing immutable history tables, jobs, hourly identities, original-turn uniqueness, quality lease and transport. No migration, new collector, endpoint, timer, dependency or quota. V1 plans/receipts still replay exactly; v2 records use a separate version and target fields without rewriting old artifacts. The existing canonical source selection and pool/mint/vault/curve state validator are unchanged.

- Maximum three pages total per mint, 1,000 signatures/page and four selected bodies/page; at most 3,000 retained signatures and 12 attempted bodies.
- At most six RPC calls per history turn and three original turns per UTC hour, shared across v1/v2. The ordinary quality cycle remains 18 calls. Canonical intake remains at most two calls, one original attempt/mint and one globally/hour.
- Existing 1,800/day quality subset inside 5,000/day global RPC, 600/day market and 800/day wallet subset remain. Pause, provider pacing/backoff, one-flight source controls, lease ownership, request-day quota charging and elapsed/day guards remain.
- Plans/receipts stay at most 32,000 UTF-8 bytes; observations stay at most 1.8 MB/turn. Current-row transfer/read bounds and all immutable update/delete triggers remain.
- No candidate, lead, legacy proof, holder, wallet or score admission/write from history. Holder quality, organic flow, independent RPC truth, current market-value binding and historical pool continuity remain unproven. Production stays thesis-only; [149's combined Free-serving/storage/CPU/recovery acceptance](149-native-builder-and-combined-free-budget.md) remains a release blocker.

## Validation and remaining work

Targeting's **25 tests** exercise exact synthetic classic and Token-2022 pairs in two original three-call turns, target-scoped cursor continuation, cross-target duplicate-body avoidance, original v1 behavior, failed-original exclusion, metadata-update non-proof, altered target/identity/time/pool/layout rejection, quota/lease/pause/day/backoff controls and unchanged three-page/eighteen-call exhaustion. Synthetic proof assembly is separate from live token quality. Focused regression: **114 tests / 8 suites**. Full Discovery regression: **1,713 tests / 117 suites**, using the handover's two workers / 30-second CLI allowance without repository test-config or runtime-deadline changes. Backend/app typechecks, closed build/performance budget (227.8 KiB gzip / 11 startup chunks), security preflight and thesis-only release guard pass. No production serving/CPU/recovery acceptance claim. Existing Worker health is 200/ready. No manual restart, collection, migration or deploy.

Checkpoint 181's original file-only replay still verifies 18 source receipts, 17 successful reviews, one canonical state receipt, two complete historical turns and the spent third transport failure. Original history cost remains 13 charged attempts without either historical proof or candidate admission. Preserve every original denominator and artifact.

The founder also questioned whether the extra quality/scoring machinery measurably beats Trending/Hot selection. It has not yet demonstrated that improvement. Coverage, proof correctness and successful unit tests are distinct from worthwhile-meme selection. The recommendation is to keep provider attention as the primary discovery feed, retain lightweight identity/security/liquidity checks, and reserve expensive evidence work for finalists. Existing v4 mixes evidence coverage, structural concerns and market characteristics; its hand-set weights and pattern ceilings are not calibrated selection probabilities. Current research earns no new scoring credit.

Next: measure repeated natural coverage and actual targeted-history page/body costs without enlarging collection. Prioritise the already planned prospective comparison of provider ordering, a light filter and the full heuristic on the same cutoff-bound attention cohorts before further scoring features or broad enrichment. Predeclare worthwhile-pick improvement and acceptable missed-runner/adverse-pick regressions, then retain unavailable scores/missing data in the denominator and measure sustained attention, founder review time and provider/storage cost. If the richer approach does not materially help, simplify it. Existing launch/evidence gates stay intact. Older admission, qualified holder acquisition/retention, meaningful flow and authoritative already-launched ATTN exclusion remain unresolved; do not treat their complexity as justified selection value without measurement. All Free/evidence/scoring/action gates and no-deploy direction remain.
