# GMGN candle coverage and price-dimensional volume checks

21 October 2026 (Australia/Sydney). Continue PRD v1.2 §4.7 with complete-window collection and reproducible unit checks. Current score-v4, all evidence/action/election gates and provider Free limits remain unchanged. No deploy.

## Collection and evidence

The official [OpenApiClient](https://github.com/GMGNAI/gmgn-skills/blob/main/src/client/OpenApiClient.ts) documents millisecond `from`/`to` for `/v1/market/token_kline`; it does not document a pagination cursor or limit argument. The prior live six-hour request returned only 100 bars. We now declare a fixed six-hour window and four standard one-minute queries of 100 minutes each, starting at offsets **0, 100, 200 and 260 minutes**. The last two overlap forty minutes. No guessed pagination parameter, Pro resolution or paid endpoint.

Each child request has a stable UUID, parent window UUID, exact mint, parent bounds and part number. Closed parent/child windows, strict time/OHLC/finite-value validation and the existing 1 MB response/1.9 MB reservation bounds remain. Atomic admission rejects duplicate slots and mismatched parent mint/timeframes before quota or IO. Four parts consume four actual shared HTTP attempts, weight eight; each remains subject to the existing provider allowance, ten-second pacing, owned lease, pause and provider backoff. Failed attempts count and are not automatically retried.

The existing maintenance pilot now has seven declared targets per mint: info, security, pool and four candle parts. Across three preregistered regression mints this is at most **21 planned attempts**, replacing twelve. It still uses at most one spare slot in the existing three-capture maintenance pass, with no extra timer or visitor-triggered source collection. A lower remaining allowance can hold any part; default bounded mode's twenty-source subset can hold the last target. Local calibration does not bypass provider limits. Interrupted work resumes only missing slots of the same window; failed/pending slots stay held.

Cached assembly verifies stored request and receipt hashes and recorded research authority. It normalizes each page and the combined window, reconciles identical overlap once and excludes conflicting minutes instead of selecting a convenient value. Missing minutes break adjacent runs; no interpolation, zero filling or blending with an older window. A full window requires all four successful parts and exactly 360 consecutive closed minutes. Public evidence selects the newest declared window end, so delayed maintenance parts from an older window cannot replace a newer window merely by arriving later. Receipt spans above five minutes remain a separate freshness gap. The new report has its own deterministic hash and receipt references; old receipts, their normalizers and scores are not rewritten.

## Volume units

GMGN's [market skill](https://github.com/GMGNAI/gmgn-skills/blob/main/skills/gmgn-market/SKILL.md) contains conflicting USD/token field descriptions. Test both orientations against each candle's USD high/low:

- If `volume` is USD and `amount` is token units, `volume / amount` should be a price within that range.
- If the reverse is true, `amount / volume` should fit instead.

At least **twelve** positive-flow candles must all support one mapping, with none supporting the reverse, allowing **1%** rounding tolerance around low/high. Missing `amount`, too few informative rows, ambiguous prices near $1, inconsistent orientation and one-zero/one-positive flow remain unknown. Both-zero flow adds no unit evidence. Missing flow is never zero.

This is explicitly **price-dimensional corroboration from the same provider response**, not independent transaction verification. It does not establish organic volume, canonical pool scope, a wash-trading verdict or score credit. Only a complete window with corroborated units can show a reported full-window USD total. Six-hour turnover never replaces the token-info 24h report or certifies 24h organic demand/meaningful holder growth.

## Live PONYX result

Authenticated normal-path collection requested **02:12–08:12 UTC** on 21 October. All four responses passed and were retained over **30.292 seconds**, using four Free HTTP attempts. The result has **328 / 360 unique minutes**, **32 missing minutes**, **zero overlap conflicts** and remains incomplete. The first part supplied 68 bars; the other parts supplied 100 each. Forty matching overlap bars count once. Missing coverage remains a provider-data gap; no claim is made that every missing minute represents absent trading.

All **328 informative candles** support `volume = USD` and `amount = token units`; **zero** support the reverse. The full-window USD total remains **null** because coverage is incomplete. The cached report measures 326 adjacent pairs, 207 rises, a longest rising run of eight, 190 alternating-body pairs, no adjacent doubling/halving and no moving candles with both flow fields explicitly zero. Current descriptive triggers do not fire. This does not establish clean trading or refute the founder's concern; wallet/trade-level validation and calibrated pattern rules remain open.

Window **`7ee4b885-801f-4839-9dec-52c144c433f3`**, report hash **`a00e272f6ba11865dc41b00c29107633f3b0aa6a1aafb8880627803c205b63d4`**:

| Part | Retained request ID | Receipt hash |
|---|---|---|
| 0 | `162e6659-c63d-4f86-b848-a8188862db49` | `0da4d5b90fde65e049c8ff366de562d3c458d3dcbb7665e5ff528bc6c3aea530` |
| 1 | `20bc1ea3-d9f7-4b84-aeba-9755c0c0777d` | `2e210ca3e9965e7e61cea4572e1bb98c5cadbcecf612f66ac138819e0075e3a0` |
| 2 | `5bdf6612-17dd-4705-b378-d9de5dfe6e51` | `14c65e641ff4b337723d1e8549e07214a66b2cd1a8b3249268d4fd7d6ea0a79d` |
| 3 | `9c517bbf-775a-4506-8a90-e3ff5afcd8b8` | `230ede8baea1e602de91743621610df1ffdffe852034191d7155ba19da731e38` |

Correction to the previous milestone: receipt `23104266-d287-41b5-b070-9f9cf815e63f` requested 01:30–07:30 UTC but its actual returned timestamps cover **05:50–07:29 UTC**, not 01:30–03:09. Its 100-bar count and unit/pattern measurements remain valid. The earlier prose inferred timestamps from the requested start; this record uses the retained response. No stored evidence was changed.

## Live USDF complete-window result

The older preregistered USDF mint (`AMK8R8NqJ18VQnxsoGgv75pZVLyAG24BafFfp3Zpump`) returned **360/360 minutes** for **02:20–08:20 UTC**, received by **08:21:15.262 UTC**, over **30.170 seconds**. Four normal Free attempts supplied 400 rows, with forty identical overlap rows counted once and no conflicts. All 360 positive-flow candles support `volume = USD` and `amount = token units`; the reverse fits zero. Reported six-hour turnover is **$47,173.76627914312**, explicitly not certified organic volume.

The full window has 359 adjacent pairs, 207 rising pairs, a longest rising run of **14**, 177 alternating-body pairs and no doubling/halving or moving both-zero-flow candle. The existing twelve-rise trigger now surfaces **Trading pattern needs review**. This is a descriptive, uncalibrated trigger; there is no candle-only wash verdict, score change or action-gate waiver.

Window **`dfb300e7-7037-4110-b71f-521e7f497b03`**, report hash **`1104780bdd07f9cbdf3692aaf27d0bd25fcd732a16d4f7b37aae3bdcd7845115`**:

| Part | Retained request ID | Receipt hash |
|---|---|---|
| 0 | `daabf46b-9723-4a91-bbdc-18cf04402deb` | `307f251d3b8f16224b3adffdcf8cee4f046d91312bfa3a9f2d7c43d4a5a2c4f3` |
| 1 | `8c91b8a9-8d4b-4af3-8087-fecfcd3c48d8` | `af27ebef63f68d5095300728b311228f6251c93e67ed63cbda4d2a5540b95cb2` |
| 2 | `f329e90a-b208-4a79-bcbe-53ffb76f44ae` | `430e14c6edc3c9a3f22379b1623088fd904577ce4b7ad7e1c7e52b05941dd76e` |
| 3 | `d32e42cc-1cd2-499e-ada9-e0072cc0334b` | `c71b5b0e16473d5f62c128a5d14f040a90377a714374e291c40f33ca75b80a0b` |

## Operator commands and remaining PRD work

From the repository root:

```powershell
node scripts/discovery-gmgn.mjs window MINT
node scripts/discovery-gmgn.mjs window-saved WINDOW_UUID
node scripts/discovery-gmgn.mjs resume-window WINDOW_UUID
```

`window-saved` and authenticated `GET /api/10x/admin/gmgn/windows/:id` are cache-only reads with zero provider requests. Resume uses the same parent window and stable child identities, skipping successes and stopping on failed/pending parts. No quota reset, implicit retry loop, signing key or financial endpoint.

If the local response is lost, the operator returns the window UUID and an explicit unknown attempt count, separately from confirmed attempts. Inspect cached state before resuming; a lost response is never treated as zero IO or permission to repeat a request.

- [x] Four-part bounded coverage collection, strict overlap reconciliation and hashed cached replay.
- [x] Unit-orientation checks, conservative unknowns and UI coverage/unit explanations.
- [x] Real four-response PONYX verification with missing minutes explicitly held, plus full 360-minute USDF coverage and a visible fourteen-rise review trigger.
- [ ] Obtain continuous provider coverage where available; classify missing/pre-launch/no-trade intervals only with supporting evidence.
- [ ] Independently corroborate actual trades and canonical pool/mint scope; measure wallet reuse, matched buy/sell flows and suspected circular activity without certifying common control from labels.
- [ ] Retain representative benign/adverse controls and prospective paired cutoffs; validate new pattern features before a versioned scoring change.
- [ ] Extend to authentic trailing-24h volume and meaningful holder growth within measured Free capacity. This six-hour pilot does not complete those requirements.
- [ ] Restore bounded research admission before production as required by [local calibration](74-local-calibration-admission.md), and resolve remaining source/release gates.

## Validation and operational limits

- **99 affected Discovery tests** across GMGN integration, candle parsing/assembly, source admission and research-mode boundaries passed, including duplicate/foreign parent rejection, delayed old-window selection, tampered hashes and archived v1 replay. **88 Discovery UI tests** passed; all five GMGN presentation tests also passed after the final incomplete-turnover wording correction. **Ten operator/IPv4 bridge tests** passed, including resume, backoff and unknown IO after a lost local response.
- Discovery/app typechecks, generated OpenAPI, final app build and performance budget passed. Startup remains **234.1 KiB gzip across eleven chunks**. Existing dependency annotation warnings do not fail the build.
- Both live cached window reports replayed to the original hashes, with schema-valid public projections and **zero provider requests** for verification. Browser QA showed the actual 360-minute USDF window, units, $47,174 reported turnover and fourteen-rise review; screenshot is local/ignored at `.tmp/gmgn-full-candle-coverage.png`.
- All **163 original score cohorts, zero outcomes and eighteen completed source receipts** in the pre-test checkpoint remained byte-identical; new captures are additions. Foreign-key checks passed. No migration, counter reset or historical score/research replacement.
- Actual query-key scans passed across **25 task files and 72 built assets**; both secret files remain ignored and untracked. Nineteen linked documentation files and 391 local Markdown targets resolved; whitespace checks passed.

Local Wrangler's previously recorded ProxyWorker error interrupted the preview during QA and initially prevented the second live test. The existing supervisor recovered it without changing its three-start/fifteen-minute circuit, after which the complete USDF collection, cached verification and browser review succeeded. The underlying runtime error remains unresolved; these collection changes do not claim to repair it. No deploy.
