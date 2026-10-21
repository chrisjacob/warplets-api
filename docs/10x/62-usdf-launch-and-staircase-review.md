# USDF: historical concentration and staircase-price review

Founder review, 21 October 2026. Exact mint `AMK8R8NqJ18VQnxsoGgv75pZVLyAG24BafFfp3Zpump`; retained pool `2YH7UbytEQFya6nHNDpcwemRRi4yz8gixrfv197pFa55`. Local only; free cached observations, unchanged action/election/source gates. No deploy.

## Evidence and interpretation

The supplied charts show an elevated first displayed valuation, repeated candles and discrete upward steps. These are grounds for review, not transaction-level proof of wash trading. Candle intervals, quote sampling, trading fees and actual beneficial ownership must not be conflated.

At 02:34:59 UTC the frozen v2 score was 54, with a 79.29 relative-depth ceiling. The signed creation wallet bought 793,100,000,000,000 raw units in the exact finalized creation transaction (20 October 02:26:52 UTC), for approximately 85 SOL. That equals 79.336% of the later verified observed supply of 999,670,870,293,877 raw units. Current creator holdings were tiny; present dispersion does not erase the earlier purchase. This ratio uses a later denominator, not independently reconstructed initial supply or proof of current common control.

The earliest retained market report is 20 October 16:37:29 UTC, approximately 14h after creation, at $6.43M reported cap. It cannot verify a $5M birth valuation. The chart's first candle is not automatically the token's first trade. Keep actual opening valuation unknown when early evidence is absent; never substitute FDV.

Saved history has two approximately 5% upward steps, with a much quieter background. The existing diagnostic sees only 54.49% upward quote steps, 1.40% sampled drawdown and R² 0.889, so its strict linear-rise rule does not flag this shape. V2's doubling/halving check also misses it. The later wallet sample has only five known-quote trades from two wallets and is stale; it cannot certify market-wide activity or substantiate the screenshot's trader counts.

## Versioned implementation plan

1. Preserve score-v1/v2 evaluators, exports and research records. Introduce v3 with the existing support calculation plus dated historical-creation-purchase, staircase and early-reported-valuation checks. No mint blacklist.
2. For a verified signed creation buyer in the exact creation transaction/slot/program, use the positive net acquisition (bounded by known purchases), deduplicate instructions, and compare with verified observed supply. Publish both dates and raw quantities. Apply a continuous ceiling from 100 at 10% to 20 at 80%; missing, contradictory, future or uncertified inputs stay unknown. Never infer current beneficial ownership from this past purchase.
3. A same-source continuous price run needs at least 60 observations over six hours, no gaps over ten minutes, at least 10% return, no more than 2% sampled drawdown, and two upward steps of at least 3% whose per-minute rates each exceed ten times the median absolute background rate. Their log returns must account for at least half the net log return. This provisional staircase-review pattern caps at 50, not a wash-trading verdict. No OHLC/wick claim from sparse price points. Do not flag truncated histories as complete.
4. Freeze the earliest retained market projection separately. A reported cap of at least $5M within ten minutes of independently verified creation caps at 60. Label it an early report, not a verified opening valuation. Later first observations leave opening valuation unknown and do not trigger that rule.
5. New concerns withhold positive momentum. Cards, detail metrics and policy explain the actual evidence and missingness. New captures use v3; older model cohorts finish separately within unchanged daily/storage/collection budgets. A local migration admits v3 without rewriting artifacts; verify existing rows before/after.
6. Retain the real v2 scorecard/history as a regression fixture. Test ordinary trends, volatility, jumps without quiet context, timing/source/duplicate gaps, missing/burn-affected denominators, creator-identity mismatches, replay, model separation and unchanged action gates. Verify the existing preview, update PRD/progress, commit and push. No deploy.

Independent labelled calibration, actual opening trades/supply, fresh representative trade coverage and OHLC/beneficial-owner evidence remain open. These transparent review thresholds are provisional and cannot establish fraud, organic trading or safety.


## Implemented result and local evidence

The same 169 saved prices produce a 168-point continuous run over 9.62h: +16.01%, maximum sampled drawdown 1.40%, two qualifying steps. V3 applies ceilings 79.29 (relative depth), 50 (staircase review), and 20.76 (historical creation purchase); the grade is **20/100**, versus the unchanged archived v2 **54/100**. Frozen v3 hash `352803b8a626bbf02eb60f0f7bb9ccaa58aa73144b9f476f3288db37c6c5738d`; original v2 hash `b2a390f5cd44c0ef412ba2539e649b38ddc8bf8688e44e7d7d0366279f0737f6`. Regression fixture `discovery/fixtures/score-usdf-review.json` retains the original card, reduced prices and earliest retained market projection. The scores use the same observation time; token expiry does not explain this comparison. The current retained-history detail also shows 20, while coverage continues to decay with staleness.

Local migration 0039 was applied only to the preserved `.wrangler/local` store after an SQLite backup. Every original cohort (100) and attempt row (104) was compared byte for byte after migration, and foreign-key checks passed; there were no existing outcome rows. Isolated tests also retain nonempty v1/v2 outcomes and verify rollback under enforced foreign keys. Actual cohorts remain 71 v1 and 29 v2. The daily 100-record limit holds new v3 captures; normal maintenance succeeds with no quota increase or reconstructed v3 history.

Cached verification replays three retained election rehearsals (442/364/363 inputs), confirms the local timer/watchdog is recent, and makes zero provider requests. A market-source issue remains degraded under existing backoff; no restart is recommended. Action eligibility is still 0/10. The existing preview at https://app-local.10x.meme renders the new score, historical/unknown dates and archived research views. No deploy.

Implementation uses D1’s documented deferred-foreign-key migration pattern and local-only migration flags: [foreign-key guidance](https://developers.cloudflare.com/d1/sql-api/foreign-keys/), [Wrangler D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/).


Validation: **917 backend tests across 56 files**, **77 discovery UI tests across 14 files**, backend typecheck, app typecheck/build, generated OpenAPI and the unchanged 234.1 KiB gzip home-startup budget pass. An additional focused 46-test launch/model replay run passes after the final timing checks. Negatives cover ordinary trends, volatility, one jump, source/time gaps, duplicates, future observations, truncation/overflow, uncertified supply/creator/trades, denominator contradictions and repeated net balances. These synthetic controls are regression coverage, not independent empirical calibration. Browser QA verifies the live local score/launch review and current v3 / archived v2/v1 selectors. Local snapshot: 0 v3, 29 v2 and 71 v1 captured; all 100 await their original outcome windows. Screenshot: ignored `.tmp/usdf-v3-preview.png`.
