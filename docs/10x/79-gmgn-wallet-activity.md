# Token-filtered GMGN wallet activity

21 October 2026 (Australia/Sydney). Continue [authentic attention](70-authentic-attention-momentum.md) and [ranked trader participation](78-gmgn-trader-participation.md) with one bounded, dated event sample. Aggregate trader totals do not supply the trade ordering needed to investigate repeated-size or same-transaction activity. This milestone adds provider-reported events, not independent chain verification or organic-volume credit. Current score-v4 and every evidence/action/election gate remain. No deploy.

## Selection and free collection

The [official portfolio reference](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-portfolio/SKILL.md), [command](https://github.com/GMGNAI/gmgn-skills/blob/main/src/commands/portfolio.ts) and [HTTP client](https://github.com/GMGNAI/gmgn-skills/blob/main/src/client/OpenApiClient.ts) document the weight-three `GET /v1/user/wallet_activity` query and token filtering. The installed CLI 1.6.7 was inspected as a second reference. The app uses its existing metered query-key-only transport, not unaccounted CLI provider calls. No private key or financial endpoint.

An authenticated operator names a retained top-trader request UUID. The [selection rule](../../discovery/src/gmgn-activity-selection.ts) replays that complete source receipt and selects the regular-wallet row with the largest positive combined buy/sell USD flow among rows with both fields. Exchange/pool and unknown types are excluded; equal flows break ties by wallet address. The source must be no more than 24 hours old and not future-dated. The request binds its exact mint, wallet, source UUID and source receipt hash; changed selections hold **before reservation or provider IO**. This rule defines a targeted investigation, not a representative sample or wallet risk verdict.

The [descriptor](../../discovery/src/gmgn-request.ts) and IPv4 [bridge](../../scripts/discovery-gmgn-relay.mjs) permit one fixed Solana request with `wallet_address`, exact `token_address` and **`limit=20`**. No cursor, type filter, different limit, URL override, other chain or automatic pagination. The existing authenticated controller verifies selection even when called through its generic review route.

All attempts use existing atomic source/market admission, research/storage accounting, ten-second spacing, one in-flight request, owned lease, timeout, pause and persistent backoff. Failed attempts still count. Weight three fits the documented Free capacity; no allowance, plan, additional timer or scheduled cohort is added. The existing three-mint/21-attempt pilot and maintenance capture limits remain unchanged. Production restoration of bounded internal research admission is still required.

## Event measurements and holds

The [normalizer](../../discovery/src/gmgn-wallet-activity.ts) reads `data.activities`, not a trader `list`, and preserves the provider's pagination state separately from completeness. It requires exact token identity and syntactically valid Solana signatures. `event_type` and the documented `type` alternative must agree if both are present. Negative/malformed token quantities, conflicting types, future or millisecond-misinterpreted times, exact selected-field duplicates, foreign mints, overflow and pages above twenty fail validation. Distinct events in the same transaction remain distinct; no undocumented instruction index or event ordering is invented.

The optional `cost_usd` field is isolated: missing, unusable, negative-signed and nonnegative numeric values have separate counts. Bounded finite decimal/scientific strings are supported; negative values are never converted to absolute volume or netted away. Unusable/signed USD holds affected side totals while independently valid identity/time/quantity measurements remain readable. No optional malformed value earns credit. Rejected required fields retain only a sanitized reason and whitelisted field names, without rejected bodies/values. The public panel shows a latest held attempt and preserves an earlier accepted sample with its own dates.

| Measurement | Semantics |
|---|---|
| Buy/sell and non-trade counts | Transfers and liquidity events stay visible but are excluded from trade amounts and patterns |
| Known first/last trade dates | Actual reported seconds; missing or zero times are unknown. No daily-window extrapolation |
| Buy/sell USD | Sum each side's `cost_usd` only when all its returned trade events have usable nonnegative values; missing/unusable/signed/no-side evidence remains null, while explicit measured zero stays zero |
| Distinct signatures / both-side signatures | Counts reported transaction identifiers; a signature reporting both buys and sells is a review cue, not a verified round trip |
| Repeated same-side token sizes | Number of events in repeated exact positive `(side, token_amount)` groups. No rounding-based grouping and no fraud threshold |
| Smallest/largest time gap | Gaps between distinct reported trade seconds, with no ordering inside a second. Any unknown trade time holds gap/span metrics; sampled gaps do not certify continuous coverage |

The public summary exposes aggregate counts and source references, without a new wallet/event list. Wallet scope is request context; pool identity and reported signatures remain independently unverified. A provider page end does not certify all history, and a next cursor is shown but never followed. Repeated amounts can be ordinary order sizing; both sides under a signature can be routing or arbitrage. Absence of either pattern establishes no clean pass. Organic volume, population coverage, meaningful growth, fraud classification and scoring credit remain held.

## UI, API and replay

The existing collapsed **GMGN activity & risk evidence** panel now shows **Selected wallet trading activity**, receipt time, event/pagination bounds, amounts/missingness and review cues. It is a cache-only read. A visitor cannot trigger collection or pagination. Legacy summaries default the new `wallet_activity` field to null.

Authenticated `GET /api/10x/admin/gmgn/activity-target/:source_uuid` returns the deterministic cached plan or a hold. The existing private saved-review endpoint additionally exports the activity request/receipt and its **complete selection-source replay record**. The [offline verifier](../../discovery/src/gmgn-activity-replay.ts) rechecks source and activity request/receipt/response/report hashes, permission, chronology and wallet selection. Archived trader v1 normalization and report hashes remain unchanged. Hash integrity is not independent provider authentication.

```powershell
node scripts/discovery-gmgn.mjs status
node scripts/discovery-gmgn.mjs activity TRADER_REQUEST_UUID
pnpm exec tsx scripts/discovery-gmgn-activity.ts freeze ACTIVITY_REQUEST_UUID
pnpm exec tsx scripts/discovery-gmgn-activity.ts replay FILE
```

The [export tool](../../scripts/discovery-gmgn-activity.ts) uses fixed loopback transport, existing ignored operator credentials, manual redirects, a 30-second timeout, bounded streams and uniquely named ignored files without overwrite. Replay reads a bounded regular file and loads no credentials/network. Existing 1 MB response/1.9 MB source reservations remain; a combined private replay artifact is capped at **4 MB** to include both receipts. No migration, source allowance, archive rewrite or deletion policy is added.

## Completed and remaining

- [x] Source-bound deterministic wallet plan and fixed, token-filtered metered activity read.
- [x] Descriptive dated event measurements, strict validation, explicit sampling/pagination and unknowns.
- [x] Cache-only UI, private two-receipt export and offline source/selection/report replay.
- [ ] Independently verify event signatures, signer, canonical scope and actual flows within existing RPC budgets before qualifying any activity.
- [ ] Establish representative controls, full-window coverage, relationship/economic/retention rules and prospective attention-model comparisons before a new score version.
- [ ] Complete true daily/creation-boundary measurements, source readiness, archive policy and bounded-admission production restoration. No release or financial authority is granted.

## Live evidence and validation

The frozen PONYX trader source is **`119ed5d0-f9d7-4620-aaae-fecd3485736a`**, hash **`514ed83a79c853aa2b22477ef670590a18ba9625d5c87f92d42cf9d86f367ac8`**. Deterministic selection chose its largest complete regular-wallet flow; the query did not expand to other wallets or tokens.

Four explicit metered attempts were made, each consuming one existing market/source HTTP slot with provider weight three. HTTP 200 payloads at **09:36:51.422**, **09:38:21.578** and **09:40:14.894 UTC** were rejected by validation. The latter two identify only `activities.cost_usd`; bodies/values were discarded and all three failure receipts remain intact. Each subsequent attempt respected the recorded 60-second cooldown; no refund, retry loop, quota reset or paid fallback.

The corrected optional-field handling accepted request **`64963533-bcc0-412c-9605-e82dbeb13d37`**, received **09:41:51.098 UTC**:

- **Three events, two unique reported signatures:** two buys and one non-trade event, with no sell events in this sample.
- Both reported buys are dated **02:43:21 UTC**, the same second as PONYX's retained creation proof. This supplies launch-time context for the earlier large flow concentration; it does not independently verify those event signatures, signer, pool or intra-second ordering.
- The two trade events report **$105,119.62946162048** combined buy USD, with valid nonnegative trade USD/quantity fields and no unknown trade times. Sell USD stays null because there is no sell-side observation. Non-trade fields do not contaminate trade amounts.
- One distinct trade second: span/gap metrics remain null. Zero repeated-size events and zero signatures reporting both sides; no listed trigger is not a clean-trading verdict.
- Provider reports page end, but population coverage and independent transaction verification remain unknown. No organic/daily volume, qualified holder growth, score or action credit.

Private freeze and complete offline source-plus-activity replay verify activity receipt hash **`3e1c2d1957fb7293112726adb3af4a9853b4fd1447860a92a4868caeec826a93`** and normalized report hash **`5321169426ee586148569a965a57d1a9ef0c83545daa2c3114a5471134bf5a9d`**. The previous trader v1 artifact still replays to its unchanged report hash **`449d50640567c8d103ce1d974c3452e2c13b92c137d39f4580582cb3ef7e8c4c`**. All export/replay work has zero provider calls/writes.

Validation: **55 backend tests** passed across activity, trader evidence and original GMGN integration; **98 Discovery UI tests across eighteen files**, the final seven evidence UI tests, and **eight bridge/operator tests** passed. Cases cover fixed requests, source ties/stale/future/empty selections, changed wallets/mints/hashes before quota, partial optional USD, duplicate/conflicting/foreign/future events, transfer exclusion, ambiguous times, exact old replay, authenticated cache-only reads, report/source tampering, provider admission and backoff. Discovery typecheck and generated OpenAPI passed.

Read-only streaming digests verified all **173 original cohorts, zero outcomes, 35 completed source receipts, 785 holder receipts and 72 wallet receipts** unchanged; foreign keys passed. Normal collection continues independently. One guarded owned launcher restart loaded the bridge route using the existing supervisor and stores. No migration, archive rewrite or counter reset.

Final app typecheck/build/performance budget passed; startup remains **234.1 KiB gzip across eleven chunks** with existing non-fatal dependency annotation warnings. Local browser QA verified the actual accepted sample, dates, counts and USD/missingness boundaries; proof `.tmp/gmgn-wallet-activity-ponyx.png`. Both old/new frozen artifacts replayed offline. Actual key scans passed across **28 task files and 72 built assets**, with both secret files ignored/untracked. All **440 local Markdown targets across 23 documents** resolved; whitespace passed. Unrelated Network/legal work remains excluded. No deploy.

Commands: `pnpm --dir discovery test src/gmgn-wallet-activity.test.ts src/gmgn-traders.test.ts src/gmgn.test.ts --testTimeout=30000 --maxWorkers=1`; `pnpm --dir discovery exec tsc --noEmit`; `pnpm --dir app test src/discovery`; final `pnpm --dir app test src/discovery/GmgnEvidence.test.tsx`; `node --test scripts/discovery-gmgn-relay.test.mjs scripts/discovery-gmgn.test.mjs`; `pnpm --dir app build`; `pnpm exec tsx scripts/generate-discovery-openapi.ts`; metered activity and cache-only saved/freeze/replay commands above. Ignored helpers checked immutable-row digests, documentation and credentials.
