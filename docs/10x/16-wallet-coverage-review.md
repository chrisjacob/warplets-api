# Finishable wallet and funding coverage

20 October 2026, Australia/Sydney. Local development only, free services, feature-branch commit/push, no deployment. **The ten-eligible-token target remains unmet.** No eligibility threshold, required proof, freshness interval or scan/output bound was relaxed.

## Diagnosis

At 17:28 Sydney time the cache contained 361 observed tokens, 195 with verified creation in 24 hours, ten passing market floors and ten passing all non-wallet gates. All ten remained blocked by wallet/funding evidence. The wallet allowance was 388/800 requests inside 1,213/5,000 global RPC reservations. Several snapshots were still v3 and undercounted buyers whose temporary WSOL account lifecycle the existing v4 verifier can certify. Full refreshes also repeatedly sampled recent trades before spending the remaining calls on direct funding, and fresh buyer anchors could strand unfinished prior scans.

## Implementation

- A funding continuation resumes exact saved signed-creation/buy anchors and checkpoints. It verifies the source evidence hash, candidate identity and prior analysis replay before network work; newly read bodies and checkpoint hashes are checked and replayed before reporting progress. All existing transaction, byte, page, signature and decode bounds remain in place.
- Continuations update only checkpoint/transaction caches and mutable `tenx_wallet_work` progress. They do not change the candidate wallet snapshot, its timestamp, profiles, recommendation cohorts or election inputs. A fresh full wallet snapshot remains necessary for eligibility.
- A later full refresh retains every prior sampled-buy anchor transaction, with original fetch timestamps, alongside current pool sampling. It cannot silently discard an earlier buyer or its funding risk as new activity appears.
- Known source/sample limits remain blocking. Scheduling gives finishable work priority; market/holder collection follows this same investigation priority. Eligibility rules, eligible-token ordering and provisional display ordering are unchanged. A provider-ended window is never called examined.
- A catch-up reserve allows at most ten 18-call turns (180 reserved calls/day at the current 800-call wallet ceiling), counted inside the unchanged wallet/global ceilings. Unused reservations are not reported as actual RPC calls. Thereafter pacing uses measured work cost. Pause, leases, provider Retry-After and both atomic daily quotas still apply. One-hour per-address retry remains for source-limited work; unfinished direct work can resume after five minutes, and a completed window set queues a fresh snapshot.
- `/api/10x/discovery/wallet-work` returns cached progress only. Discover shows examined windows, decoded/pending bodies, next step, gaps and original snapshot timing separately from eligibility.
- Authenticated `wallet-replay` upgrades up to ten cached legacy inputs to the already-certified v4 decoder, with zero provider calls. Original observation/record/page times are preserved; future checkpoints are excluded from the historical replay. The candidate update uses a source-hash comparison to protect newer concurrent snapshots. Cohorts and elections are untouched. Profiles retain the same original observation time.
- The loopback relay now spaces RPC starts by one second, with its existing bounded queue, shared 429 cooldown and no redirects/TLS changes.
- Additive local migration `0013_wallet_work.sql`; no new dependency, credential, environment variable, paid provider or remote resource. The supervisor restarted only its owned launcher to load the new pacing. Existing automatic collection continues locally.

## Measured progress and limits

The cache-only replay recovered **nine additional verified buyer observations across seven recent token samples**. XTO (`DKCEtA5…`) and Flop gained three buyers each; broom cat gained its third buyer. Other samples gained coverage while remaining below the three-buyer minimum. Original observation times stayed between approximately 14:58 and 14:59 Sydney time. Three unrelated older cached inputs were also replayed without new buyers; all ten replays passed.

For AODF `MFgq2fX…`, a 13-call continuation reached one examined funding window and 12 decoded bodies; a later ten-call continuation reached **two of six windows and 19 decoded bodies**. Its published wallet snapshot remained at 15:29:55 Sydney time. DHPx… reached 13 decoded funding bodies, but its creation-wallet history ended before a dated boundary; it remains source-limited, with further references pending. These counts are bounded samples and not clean-wallet findings.

The public RPC returned 429 responses during collection, delaying both wallet and holder freshness. Backoff was retained across restart and never cleared to force progress. At 17:52 the cached observation was 363 stored / 196 created within 24 hours, ten passing market floors, five passing non-wallet gates and **zero eligible**. Counts can change as local observations age or refresh. No claim is made that the remaining free calls can produce ten qualifying tokens: missing dated boundaries, the three-page/twelve-body funding bounds, unknown/unsupported transactions, source omissions and stale evidence continue to block.

The corrected budget audit at approximately 17:53 showed RPC 1,327/5,000, wallet 465/800, market 183/600 and artwork 57/120, with 108/180 catch-up reservations inside those RPC allowances. The old smoke checker assumed every usage bucket was RPC or market, causing its assertion to fail on artwork/catch-up counters. Status now declares those bucket ceilings and the checker validates each recognized counter plus wallet/quality sublimits. Automatic approval review initially blocked a manual refresh based on that assertion; after the corrected zero-provider audit passed, the same bounded action was approved and completed. No quota was reset or increased.

## Validation

- Full discovery suite: 177 tests passed. Nine work tests cover immutable continuation snapshots, exact-anchor retention, source gaps, ordering, recorded real v3→v4 buyer recovery, original timestamps/cohorts, cache tampering, stale progress invalidation, quotas, pause, leases and backoff.
- Discovery typecheck, app build/typecheck and performance budget passed. Relay tests passed (2).
- Local smoke replay passed: four paired creation/graduation proofs, four account snapshots, three holder inventories and three wallet snapshots; unauthorized admin 401, authenticated reads 200. Zero provider requests from the check.
- Three current/legacy election snapshots replayed unchanged with zero provider calls.
- Browser inspection verified the separate progress panel, source-limit labels and truthful zero-eligible target. Generated OpenAPI includes cached progress and the protected offline replay route.

Operator commands: `node scripts/discovery-operator.mjs wallet-refresh [mint]` chooses continuation or fresh analysis according to the same collector; `node scripts/discovery-operator.mjs wallet-replay` performs the cache-only legacy upgrade. Automatic refresh uses the existing local timer. Neither command overrides quotas, pause or provider backoff.

## DEX Paid hypothesis

The user asked whether paid DEX Screener tokens should be favoured. No paid-token eligibility rule, selection weight or new provider polling was enabled. Enhanced Token Info, advertising and boosts should be separate proposed research features, captured at observation time and evaluated against comparable unpaid tokens with chronological holdout outcomes. Payment is an observation about promotion, not proof of organic demand, payer identity or safety. Missing paid status must remain unknown, not be inferred from a logo or social links.

Primary references: [Solana signature history ordering and cursors](https://solana.com/docs/rpc/http/getsignaturesforaddress), [Workers practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [DEX Screener token information](https://docs.dexscreener.com/token-listing), [paid boosts and visibility](https://docs.dexscreener.com/boosting). Next coverage work should measure source completeness and sustainable fresh-snapshot cost; fee/promotion hypotheses must not replace unfinished wallet evidence.
