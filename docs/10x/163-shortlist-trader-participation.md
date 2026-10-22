# Focused trader participation on the attention shortlist

23 October 2026, Australia/Sydney. Continues the participation priority in [162](162-personal-review-backup-restore.md) and the provider-first acquisition design in [158](158-cross-chain-attention-intake.md). No deploy.

## Delivered

- [x] Connect the existing GMGN `token_top_traders` adapter and strict trader validator to the attention queue. Fixed Solana request: at most100 traders ordered by reported buy volume descending, without a tag filter. No new endpoint, relaxed parser, wallet-address display or automatic quality verdict.
- [x] One token total per UTC hour, selected from the first20 fresh, non-adverse attention leads with a fresh DEX cross-check. Prefer unattempted leads, then the oldest attempt, keeping queue order for ties. Skip a saved sample received within two hours. Read spent attempt metadata independently of the displayed summaries so failed attempts and receipt truncation do not repeatedly select the same leader.
- [x] Authenticated operator route `/api/10x/admin/discovery/attention/traders` and local command `node scripts/discovery-attention.mjs traders`. The supervised local timer admits traders after attention lists, DEX review and candles. Production cron is unchanged.
- [x] Retain original request, receipt and response hashes in the existing store, and revalidate them before deriving the saved summary. A configuration/admission hold spends no request. Failed, invalid and empty attempts keep the hourly slot spent. No refunds, provider retries, quota resets or new allowance.
- [x] Cached UI shows returned/limited rows, regular-wallet/non-wallet/unknown classifications, missing versus complete flow fields, reported sample buy/sell flow, positive two-sided rows and largest/top-five shares within complete wallet flow. Missing fields remain unknown. Unsupported chains, pending reviews and stale samples remain explicit.
- [x] Review notes capture a matching trader summary when present. Its optional field has no default, preserving archived v1 contexts without that field and their hashes. Captured samples are immutable copies; mismatched chain/contract/time and later tampering fail validation. Existing backup/restore still uses the original verifier.

## Interpretation and limits

This endpoint returns a ranked sample, not the trader population. Its aggregate reporting period is undocumented. Do not call its volumes24h, compare/divide them against candle or DEX24h totals, or infer holder count/growth from returned wallets. The largest/top-five shares describe the complete sampled buy-plus-sell flow, not token supply concentration. Unknown address types are excluded from wallet aggregates; incomplete flow rows are excluded without replacing missing values with zero. Two-sided trading alone does not establish wash trading.

Receipt replay establishes internal integrity. The response does not echo a token/pool identity that independently binds the sample; attribution remains request-context-only. These observations do not establish organic participation, safety, graduation or launch eligibility. No changes to queue ordering, provider-family votes, v4 scores, candidate/proof records, action/election/financial policy or evidence gates. High concentration still requires context rather than a blanket scam label.

## Free-tier and serving bounds

The pilot adds at most24 hourly HTTP attempts/day to the existing96 nominal attention/DEX/candle slots. The combined120 is demand within the shared600 market-request ceiling, alongside ordinary market work; it is not a guaranteed budget or a separate allowance. Existing provider entitlements, weighted GMGN pacing (trader request weight5), source/research-mode limits, pause, leases, shared market backoff, response-byte and transport limits still decide admission. No paid service or tier change.

Cache reads keep the same48-receipt/8MB maximum, allocated28 attention,8 DEX,6 candles,6 traders. Collecting turns use10/4/3/3, at most20 receipt replays plus the selection query, leaving room for reservation/transport work. Reduced attention/candle history is explicitly marked truncated. Summaries do not become additional discovery snapshots or votes. Old queue reports parse with an empty trader list. This bounded pilot is not full shortlist, full-day or multi-chain participation coverage and does not close the serving assessment149 hold.

## Local evidence and validation

The first authorized attempt was held by ordinary market partial-refresh backoff with zero provider calls and no reservation. After its normal expiry, `attention-traders-2026102215` succeeded at2026-10-22T15:11:32.495Z, costing one metered HTTP request. It returned100 rows, all classified regular wallets with complete flow/count fields,86 reporting positive buys and sells. Largest sampled flow share was13.8%, top five27.2%; these are descriptive sample shares without an organic/safety conclusion. The saved view contained110 observed identities,100 returned,8 discovery/market lists and one trader review, with truncation declared.

Only the verified idle Discovery launcher was restarted to reload the local timer helper; the supervisor, database, quotas and backoff remained intact. Its next ordinary cycle held the already-spent trader hour with zero provider requests. No migration, dependency/configuration change or deployment.

Tests cover field missingness and identity/period limits, fairness after a failed attempt, once-hourly/empty/invalid charging, authentication/configuration/pause/budget/backoff holds, replay tampering, unrelated-receipt exclusion, unchanged votes/proofs/scores and saturated four-bucket read bounds. Final backend:1,496 tests/101 suites pass; frontend:1,037 tests/176 suites pass; both typechecks and14 relay/operator checks pass. An initial concurrent backend run had one5-second funding-test timeout; its41-case suite passed in isolation, followed by a successful full backend run. Backup/restore preserves original contexts with and without trader samples.

Closed production build, performance budget, thesis-only guard and security preflight pass. Home startup remains227.8KiB gzip across11 chunks. The unfinished product is absent from that closed release build. This does not release the enabled-feature serving/performance hold.

The actual-component browser exercise renders the frozen live sample and explicitly synthetic missing/stale/absent variants without source IO. Chain filtering, top-ten display, closed launch messaging and desktop1280/mobile390/reflow320 overflow checks pass with zero browser exceptions. Screenshots were visually inspected. It does not establish full-app accessibility, organic quality or release acceptance. Older private evidence/proof rows remain preserved; no actual founder labels were manufactured.

## Next build order

1. Use this sample for focused wallet-event follow-up and separately sourced holder observations on the small shortlist. Establish event windows, coverage and qualified-holder changes before making organic-volume or holder-growth claims; keep unknowns visible.
2. Measure prospective founder review completion/latency, useful unfamiliar discoveries and false reassurance over successive days. Existing personal notes support this work; retrospective successful examples alone cannot calibrate a classifier.
3. Connect authoritative completed-ATTN-launch exclusions before enabling launch selection. Continue broader candle/chain coverage only within demonstrated Free capacity; optional keyed sources need measured marginal value.
4. Keep shared review custody and extra scoring complexity behind product usefulness, source-bound serving149 and independent UX/performance/security acceptance. Preserve thesis-only production exposure until separately authorized.
