# Canonical older-runner research intake and measured live coverage

23 October 2026, Australia/Sydney. Continues [179](179-fair-attention-followups-and-older-runners.md). Local migration only; no deploy.

## Delivered

- [x] Correct attention market attribution: carry the pool address from the same validated market source that supplies the displayed market values. Previously, a GMGN observation with no pool could retain a null pool even after a fresh DEX cross-check. Original source receipts and frozen review artifacts are unchanged.
- [x] Add `canonical-attention-intake-v1` research admission for older Solana attention runners. Select the first fresh, non-adverse, market-cross-checked row with a pool and a positive provider opening timestamp at least 24 hours earlier, excluding previously attempted mints. There is no upper age limit. Preserve source position, exact mint/pool, cutoff, selected row, source-view hash and policy hash before any RPC. Reported opening time is not proven creation or graduation age.
- [x] Reuse the existing canonical PumpSwap WSOL pool derivation and state verifier. Compare the observed market pool with the derived canonical pool; a mismatch consumes the original research attempt without an alternative pool, quote or target. Check mainnet genesis, then fetch mint, pool, curve and both supported base-vault alternatives plus quote vault in one finalized six-account batch. Reuse owner, discriminator, authority, token-program/extension, ATA, reserve and completed-curve checks. Retain adverse authorities as adverse facts. The verifier's checks are unchanged; its identity parameter now names the exact state fields it consumes without manufacturing a migration transaction.
- [x] Run only within the ordinary quality lease, after existing candidate work, using at most two remaining calls from its unchanged 18-call cycle. Charge the existing quality subset and global RPC budgets. Maximum one research attempt per UTC hour and one original attempt per mint; failed, missing and uncertain results stay spent. Preserve pause, owner/lease loss, elapsed-time/day guards, provider backoff and all Free limits. No new timer, manual dispatch or quota reset.
- [x] Retain immutable plans and raw state receipts in migration 0049's separate research tables. Missing local tables hold collection safely. Current pool verification cannot write candidates, migration/origin proofs, holder evidence, scores or launch eligibility. Receipt fields explicitly keep historical creation/migration false, holder quality unknown, market-data binding false and scoring effect none.
- [x] Back up and integrity-check local D1, then apply only 0049 locally. Verify only two new tables/four immutable triggers, unchanged previous table definitions, unchanged-or-increased usage counters and database/FK integrity. No remote migration or deployment.

The two-call state observation is useful canonical intake groundwork, not complete historical admission. It does not independently certify RPC truth, historical pool uptime, graduation age, organic volume, holder acquisition or current market values.

## Actual scheduler observations

A consistent, read-only snapshot at 04:09:49 UTC replayed original request/receipt/response hashes and normalized actual retained responses. No engineering provider request or database write was needed. The earlier private 04:07 snapshot is also retained; the later snapshot adds the newly due ordinary trader result.

| Ordinary observation | Measured result | Interpretation |
|---|---|---|
| 04:05 UTC BSC DEX allocation | 20 requested, 20 distinct returned; 13 targets with positive reported opening age over 24h; 16 below the old global top 20 | Exact fair-scheduler replay match; does not match old selection. This is verified new coverage beyond the old cutoff. |
| 03:02 UTC Solana DEX allocation | 8 requested and returned, including 3 reported older targets | Matches the old scheduler. Corrects the initial impression that this pre-commit allocation already demonstrated the new 20-token Solana batch. |
| 03:00 and 04:00 UTC candle jobs | Two different mints; 60/60 candles each; USD-volume/token-amount price consistency in all informative candles | Usable hour windows, not independently verified trades or organic-volume proof. |
| 03:00 and 04:00 UTC trader jobs | Two different mints; 100 returned rows each | Ranked samples; period/population coverage remain unknown. No wash-trading verdict or 24h organic-flow credit. |
| First ordinary canonical research attempt | Succeeded, two charged RPC calls; raw state/receipt exactly replays; mint/freeze authorities revoked | First original queue selection, not a hand-picked replacement. Historical creation and migration still unproven; no candidate admitted. |
| Current bounded Solana attention view | 36 returned Solana identities; 8 fresh cross-checks, including 3 reported older identities | Earlier 02:58 snapshot had 34 Solana identities and no fresh cross-checks. Snapshot times/composition differ; this is not a causal token-quality comparison. |

The older 02:00 candle window remains incomplete at 57/60. The retained 01:00 trader failure remains a failure. Current replay summaries are bounded (three candle/two trader reviews in the view); falling view counts are not lost receipts. One successful new chain allocation is evidence of repaired acquisition, not evidence of consistent worthwhile selections, lower scam rates or market-wide coverage. Keep collecting ordinary hourly results across chains and adverse/missing outcomes before making those claims.

Latest private input SHA-256: `f8591697889691d68cae2da3bd03d43627c0cfb9e628fbca70399f86b27e84bb`. Result: `e707862ff63af82ee6d3e2acd344b093c3b0b10be1927f3316145676e0ce4f26`. A separate process replays pinned source, scheduler, candle/trader and canonical receipts without database/provider access. Local hashes protect integrity, not independent provider authenticity.

## Verification and next build order

The focused suite passes 45 tests, including 22 canonical-intake cases. Full Discovery regression: 1,660 tests / 114 suites. Backend typecheck, app typecheck/build, performance budget (227.8 KiB gzip / 11 startup chunks), security preflight and thesis-only release guard pass. Tests cover malformed accounts/plans, classic and Token-2022 vault paths, active authorities, unknown/young/stale/adverse leads, immutable/spent work, quota exhaustion, wrong cluster, 429 backoff, ownership/day changes and migration absence. Private hashes, credential exclusion and historical row/FK preservation are checked before commit. No new UI or production serving/CPU acceptance claim.

1. Complete separately versioned historical origin/migration discovery for canonical older leads under existing Free budgets. Bound history work and preserve exact instructions, identities, slots, original failed attempts and unknowns; never derive a historical event from current state or provider age. Different protocols/noncanonical pools remain unsupported until their own verifier exists.
2. Measure ordinary successful cross-checks, complete candle windows, trader samples and canonical attempts across chain/age/source-position strata over multiple hours. Track costs, adverse, failed, unsupported and missing outcomes as well as successes. Do not force spent jobs or repeatedly investigate named examples.
3. Obtain qualified holder acquisition/retention and meaningful flow for the shortlist, then prospective founder usefulness and mature independent outcomes. Current research receipts earn no grade-weight adoption.
4. Connect authoritative already-launched ATTN exclusions and finish the daily curated shortlist. Complete [149's combined Free-serving acceptance](149-native-builder-and-combined-free-budget.md) and named recovery/security blockers before release. Further bespoke status panels are not the next default feature.

Keep everything free and all evidence/action gates unchanged. Production remains thesis-only. No deploy.
