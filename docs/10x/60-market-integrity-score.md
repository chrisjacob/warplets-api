# Market integrity checks after the XTO review

Founder requested this review on 21 October 2026. Scope: local scoring and explainers; free cached evidence, no source refresh, deployment or action-policy change.

## Evidence and failure

The supplied lowercase address resolves in retained evidence to PumpSwap pool `AW9UyqdrLpqnt3gp8sTpECMTMECpfyC59iLa2bwKmLjg`, for XTO mint `TbX69Z9YEbBF647xRQSEKkdM5z99aAM8zyfXuUapump`. At 02:03 UTC it ranked first at 86 under discovery-score-v1 (86.62 base points; no ceiling).

Saved same-source DEX Screener observations jump from $0.08604 to $0.1935 (+124.8954%) between 01:16:34.724Z and 01:20:34.505Z: about four minutes. The 02:03:18.342Z snapshot reports $197,874,700 cap and $1,218,636.61 liquidity (0.616%). These are provider observations, not independently verified executable depth or supply.

The bounded, stale 00:56:27.641Z wallet analysis contains one initial creation buy of approximately 85 SOL and seven later trades, each below 0.001 SOL, across five wallets. It cannot establish total trading activity, coordinated ownership or wash trading. Fee arithmetic did not reconcile for six of eight sampled trades; that is an evidence gap, not a fraud finding. The web reader could not fetch Pump/DEX pages. A later browser review of the [exact DEX Screener pool](https://dexscreener.com/solana/AW9UyqdrLpqnt3gp8sTpECMTMECpfyC59iLa2bwKmLjg) at about 02:14 UTC corroborated the stepped chart: approximately $198.2M cap / $1.2M liquidity, about $622K buy volume against $23K sell volume, and multiple latest trades around 0.0003–0.0005 SOL alongside larger trades around 0.14–0.16 SOL. These transient provider displays do not prove all trading is fabricated. Automated regression findings use the retained local evidence.

V1 rewarded three distinct buyers regardless of notional and awarded positive sampled momentum despite this jump. A low liquidity/cap ratio could lose only five points. Dispersed token accounts do not prove independent beneficial owners. No address blacklist is appropriate.

## Implementation plan and policy

1. Preserve the exact v1 evaluator, exported artifacts, action/election rules and prospective v1 cohorts. Add discovery-score-v2, strict schemas and offline replay. Publish both model identities; the existing outcome study continues explicitly as a v1 comparator and must not be presented as validation of v2.
2. Read bounded cached 24h price projections (256 per mint, at most 500 mints and 16,000 projected prices in aggregate); keep the existing 2h/64 positive-performance calculation. Mark truncation; observed adverse pairs can still constrain the score in incomplete history.
3. Consecutive positive same-source prices at distinct instants no more than ten minutes apart: a doubling or halving caps at 40. Break comparisons at missing, duplicate, future or source/gap boundaries. Retain the dated concern while it is inside the 24h observation window.
4. Relative-depth ceiling = `100 × sqrt(min(1, liquidity / reported cap / 0.05))`. Reuse the published 5% reference, with a continuous penalty; missing cap/depth stays unknown, FDV is never substituted. Existing absolute-depth ceilings still apply. Stale adverse reports stay dated and visible.
5. Exclude the creation buy from participation. A wallet needs at least 0.01 SOL of known later sampled buys to earn buyer credit. For at least five later known-quote trades across at least three wallets, at least 80% at or below 0.001 SOL caps at 40. Unknown/duplicate/future rows cannot support these findings. This describes the sample, not whole-market trading authenticity.
6. Withhold momentum credit whenever these new concerns constrain the score. Show short risk flags on cards, full dated findings/metrics and sample gaps on token pages; publish all thresholds. Heuristic thresholds are provisional and require independent adversarial/outcome evaluation.
7. Verify real retained regression evidence, normal volatile/meaningful-trade controls, boundaries/gaps, deterministic ranking, tamper detection, old replay and unchanged action/election gates. Update PRD and task map, commit and push. No deploy.

## Validation results

The retained v1 scorecard (record hash `aba4a51817ad096c97139971179d22e0a7067d31d90f3cd9097d61571619def1`) replays at 86. Applying v2 to the identical candidate and saved history yields 35, with a 35.10 relative-depth ceiling, a 40 jump ceiling and a 40 dust-sample ceiling. The original earlier v1 artifact `457bce8cdc93a5bcade2c746ae06c8fdc96303cbdd39c55b7ca8c6a4f1ba8e9b` remains replayable. Public regression evidence is retained in `discovery/fixtures/score-xto-review.json`; no live store was seeded or rewritten.

Targeted tests cover the real regression, ordinary volatility/material participation, doubling/halving boundaries, mixed sources, time gaps, duplicates by instant, future/missing observations, truncation, old jumps, aggregate projection bounds, exact quote thresholds, small/unknown trade samples, tamper rejection, rank-before-limit and unchanged action/election replay. The public local check at 02:11:56 UTC returned 70 recent scored candidates, zero eligible and 10 provisional; the first-ranked token changed to AODF at 70. These are observations, not endorsements.

Validation completed: 871 backend tests across 53 files; 75 discovery UI tests across 14 files; backend typecheck; app typecheck/build and unchanged 234.1 KiB gzip / eleven-chunk home startup budget. Browser QA verified XTO at 35 with dated concerns, the saved chart, updated cards and the published method. Both loopback and preview history/score responses parsed; the live v2 export replayed. Three retained election rehearsals replayed unchanged. The independent watchdog was fresh with no restart recommendation; the pre-existing wallet-source issue remains visible. No source refresh was forced, no live evidence was seeded and no deploy occurred.

## Remaining validation

[Prospective v2 retention is now implemented](61-versioned-score-research.md); new captures use v2 while archived v1 outcomes finish without rewriting records. The remaining validation points below describe the original review checkpoint.

V2 is a transparent conservative review model, not a calibrated scam probability. Independent labelled evaluation, v2 prospective outcome cohorts, richer post-migration trades, true beneficial ownership, source quote cross-checking and actual executable depth remain open. Do not tune the frozen v1 cohort retrospectively or claim this single example validates thresholds.
