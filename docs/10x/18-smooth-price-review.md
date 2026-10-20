# Sampled smooth-rise review

Implemented locally on 20 October 2026 after the founder highlighted the almost linear price and market-cap rise in American Oil Dividend Fund.

The chart panel now evaluates its already-loaded price observations and shows an amber **Unusually smooth price rise · review** notice when the latest comparable run matches `sampled-linear-rise-v1`. Other results are explicitly **insufficient comparable history** or **rule not triggered**; neither is a safety or organic-activity finding.

The unvalidated diagnostic requires all of:

- At least 20 prices across at least 60 minutes, within the selected chart range and the past 24 hours.
- At least 5% endpoint price return.
- At least 90% of comparable steps upward, counting unchanged steps in the denominator.
- At most 1% drawdown from any preceding sampled peak.
- Price-versus-elapsed-time linear regression R² of at least 0.98, with a positive slope.

The exact metrics, sample count, run duration, provider and last observation time are displayed. R² measures goodness of fit, not the probability of manipulation. The thresholds are an engineering starting point for reviewing the founder's observation, not empirically established fraud thresholds.

Only the latest continuous run is assessed. Missing, zero or nonfinite prices, duplicate timestamps, source changes and intervals over ten minutes reset that run. Future or invalid times are ignored and disclosed. Prices older than 24 hours are outside this diagnostic even when the chart shows seven days. Samples older than three minutes are labelled stale; any warning then describes the saved series, not the current market. Breaks stay visible rather than being silently joined. Uneven sampling is handled using elapsed timestamps rather than array indices. Flat prices have no meaningful linear R².

The initial cached AODF check covered 59 observations from 04:29:26 to 07:37:56 UTC on 20 October (188.5 minutes): approximately 26.16% return, 56 upward and two downward steps, 0.10% maximum sampled drawdown and R² 0.9978. It triggered the review notice. This describes the retained provider snapshots; it cannot rule out intraperiod reversals or establish fraud. No other token's authenticity is inferred from being more volatile. The market-cap chart is not counted as an independent second signal.

This change adds no provider requests, polling loops, dependencies, migrations or deploys. Existing eligibility gates, ranking, collection scheduling, frozen research/election payloads and replay rules remain unchanged. Outcome validation and any eventual scoring proposal remain future work; this diagnostic does not claim the daily learner is already training on the new feature.

Validation: 190 discovery tests passed, including linear/curved/flat/falling/volatile histories, irregular timestamps, source and coverage breaks, stale observations, missing data and non-mutation. App build/performance checks, discovery typecheck and browser review accompany the implementation commit.
