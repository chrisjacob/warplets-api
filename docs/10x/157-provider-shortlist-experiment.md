# Simpler Discovery: provider shortlists, then focused review

22 October 2026. Founder requested an actual comparison of a few provider queries rather than more bespoke acquisition/scoring machinery. The experiment supports a smaller acquisition funnel. It does **not** establish scam-detection accuracy, organic attention, historical returns or a production-ready ranking.

## Live comparison

The final list queries ran around12:47UTC; DEX cross-check completed12:54UTC. All GMGN requests fixed chain=sol, platform=Pump.fun, limit=100, order_by=volume, direction=desc, filters=renounced/frozen/is_out_market. Repeat URL parameters match the official CLI. These are provider filters, not independent contract/graduation proofs.

| Variant | Interval | Provider age bounds | Minimum liquidity / interval volume | Returned |
|---|---|---|---|---:|
| Day two broad |24h|24–48h|$10K / none|6|
| Survivor week |24h|24–168h|$25K / $100K|14|
| Active survivors, wash filter |1h|24–168h|$25K / $10K; not_wash_trading|13|
| Recent runners control |24h|0–168h|$25K / $100K|26|
| GeckoTerminal trending |24h|none|none|20 pools|
| GeckoTerminal trending |6h|none|none|20 pools|

Deduplication produced51 mints. One DEX Screener tokens batch cross-checked30 prioritized mints. Query appearances are not independent votes: four GMGN variants remain one provider. Gecko contributes other leads but includes older tokens and provides no comparable security fields here. Cross-provider volume differs materially (token aggregate versus pool coverage); do not sum it or call agreement independent organic-volume proof.

The native GMGN market response has two business envelopes. Both success codes now pass validation before the bounded rank array is retained. Three failed shape-validation attempts remain charged; a successful diagnostic and the seven final list/cross-check requests make11 charged attempts total, eight retained. Held local admissions cost zero provider calls. Preserved shared backoff delayed the cross-check; no quota/backoff reset or scheduler disablement occurred. Two later follow-up plans (paired strict24h filter, remaining15 recent mints) were prepared but **not executed**. The1h/24h comparison is confounded by interval/activity differences and cannot measure the wash filter's incremental effect.

Private inputs, plans, failures, held admissions and report are under `.tmp/provider-shortlist-20261022-157-*`, `.tmp/shortlist-diagnostic-157-*`, `.tmp/shortlist-review-policy-157.json`, `.tmp/shortlist-review-157.json` and `.tmp/shortlist-review-157.md`. Preserve originals; create new outputs for subsequent studies.

## Provisional ten to inspect

The research screen was frozen before the DEX response: reported open age24–168h; liquidity≥$25K; daily volume≥$100K; last-hour volume≥1% of daily; reported buys and sells; explicit GMGN mint/freeze-disabled flags; no positive wash flag or unknown wash flag; hold top-ten≥50%, provider insider≥30%, bundler≥50%; hold daily change≤−50%; hold missing or >2× cap/liquidity disagreement. These are **uncalibrated research bands**, not new product/election rules. Sort the remaining queue by reported daily USD volume, then hourly volume, then mint. A hold means unresolved review, not a scam accusation. Below are the first ten among the inspected union; this is not an exhaustive market top ten. Provider open time is not verified graduation time.

| Token | Mint | Approx. 24h DEX volume | Reported open age |
|---|---|---:|---:|
|PHP|Cbkg5w7V7W2J2sUmecnyN825CbvwvXwasfhduVtNpump|$4.30M|31.6h|
|Macca|AKotzk1dhcNangAJBtvNKtT9bhbSVZc2mMhRFgkFpump|$1.77M|167.1h|
|LUKE|Ez7eEs53hQiXgCGmcbhdX5i1jgg2gC3F6MoeosuVpump|$1.07M|91.7h|
|Gato|55A3VxMBfzw6uSe64zms5iMPw9k6kx9WzzusbCU6pump|$844K|133.9h|
|Kimchi — Larp Final Boss|1RjmyJbkSeQFd2fmc2LBhnPF45dSGGBzNGo6bw9pump|$591K|37.5h|
|COMPUTE|GWe3TNg1UPxeaSazxK8U49PDAqXCaX9Jc8zbttFLpump|$502K|72.5h|
|MOMO|FhTRVAkQeiaLRJHYc13DBNhgw9N8ZPacvonaKfXxpump|$395K|131.0h|
|Kim|ESABfJpt9cocXgWX7HF8WwSXrcv785oyaA8imwojpump|$236K|85.1h|
|onboard|5ubruMYpgKqw9ip5J1qrXbVGmMdn2VCsMg421B4bpump|$217K|136.9h|
|ZENO|FMGe8RStdPc1YR59BBuV5Ui12DEe3Q2zVoihrJBbpump|$145K|89.5h|

These are research candidates. Gato and Larp Final Boss carry >20% provider bundler labels. Most have a nonzero provider rug metric whose semantics are uncalibrated; none receives a safety pass from that field. MOMO is down about11% daily and onboard about49.8%; daily turnover alone is insufficient evidence of continuing momentum. Macca is close to the experimental seven-day cutoff. No chart/candle or organic-holder-growth qualification was performed in this list experiment.

The **original** successful Kimchi, CSocnzcRpgSCr1naKcNTieWZUxb6rABe45j844m7pump, led reported attention but entered concentration review: top-ten78.29%, provider insider75.33%. It was not labeled a scam or granted a mint-specific exception. Its inclusion in not_wash_trading does not resolve those separate risks. Missing GMGN records for Gecko-only tokens likewise mean unknown, not failed safety checks. Younger CYBER, SHAV and ヤギ form a separate watch queue, not survivor replacements. Known earlier scam references were not returned by these lists; this run does not prove their detection or exclusion.

## Revised build order

1. **Small cached provider research queue.** Use two GMGN views (24h survivor activity,1h continuation) plus one Gecko discovery view; deduplicate exact chain/mint, age-filter known reported timestamps, and batch market checks for the small union. Cache lists and expose their observation times, unknowns, review reasons and separate young/survivor/concentration views. Do not require membership in all providers: missing security data receives a focused follow-up. Do not force ten results. Broad floors remain adjustable comparison inputs rather than universal market rules. Show no organic-attention badge from raw turnover or holder totals.
2. **Spend richer checks on the shortlist.** Exact-mint security and existing candle/trading checks for roughly10–20 leads; verify canonical pool and actual graduation separately where needed. Preserve all existing action/election/source/time gates. Keep high attention visible alongside concentration review so exceptional winners are not silently erased or falsely called safe. Inspect daily continuation and recent share of activity separately from risk. Defer screenshot AI and another composite score until this simpler workflow proves useful.
3. **Daily prospective evaluation.** Save3–7 independent daily runs and founder chart reviews with explicit outcome times, known bad references and successful concentrated references. Measure useful unfamiliar leads, review burden, missingness, false reassurance and source costs. Compare narrower24–48h and wider survivor windows without choosing parameters to fit a single named winner. No backtest-performance claim from current cross-sectional lists. Use real graduation age once established; retain unknown-age discovery leads without granting action authority.

This reprioritizes acquisition research before more custom all-token enrichment. Existing model-v4, eligibility, election, financial actions, source evidence and production exposure are unchanged. The existing first-day action scope is not silently broadened to these older research leads. Ordinary migration intake remains available for proof acquisition and coverage comparison. Free serving admission149, UX/security and the thesis-only release hold remain open requirements.

## Implemented and validation

New explicit authenticated POST `/api/10x/admin/discovery/shortlist-query` supports only bounded GMGN market rank, Gecko Solana trending pages1–2 and exact-mint DEX batches≤30. It uses existing shared source reservations, request hashes, replay receipts, quota charges, lease/pause/backoff and byte/depth limits. Fixed hosts/paths, TLS, cancellation, no redirects, no arbitrary URL, no candidate/proof/score writes and no automatic schedule. Absent fields stay null; cap and FDV stay distinct; malformed mint/chain/future-time rows are rejected with reasons. Safe failure diagnostics retain only whitelisted field types, not rejected bodies or provider messages. Existing GMGN candle normalization is unchanged.

Relevant backend/relay regressions, Discovery typecheck, security preflight, thesis-only build check and historical evidence/credential-preservation checks pass. No dependency, schema, budget, v4, exposure flag or deployment change. One supervised local Discovery restart loaded the Node relay routes; ordinary collection continued. The operator query path is implemented; the proposed cached product queue is next, not already adopted.

Sources: [official GMGN command parameters](https://github.com/GMGNAI/gmgn-skills/blob/main/docs/cli-usage.md), [official CLI implementation](https://github.com/GMGNAI/gmgn-skills/blob/main/src/commands/market.ts). Live retained observations establish the dated counts above; documentation alone does not establish token quality.
