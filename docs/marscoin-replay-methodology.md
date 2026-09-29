# MarsCoin first 41 days replay

Uses exactly 41 real UTC daily pool closes, 27 July–5 September 2026 inclusive,
from marscoin-daily-pool-source.json. No intraday ATH point is inserted.
Playback advances every 180ms; reduced motion shows the complete history.

Market-cap values are daily close × 1B reported supply. Historical circulating
supply has not been independently verified. The visible estimate label and
source panel were removed at user request; tooltips and accessible chart text
retain the estimate qualification. Raw provider responses remain in docs.

Gross launch gain = (daily close / 0.0000489098406985415 - 1) × 100, using the
first recorded pool candle open. This is not a guaranteed executable entry;
it excludes taxes, fees, slippage and rewards, as the tooltip explains.

The scale starts at $10M and expands with the running peak. It does not contract
during a pullback. The day slider is removed.

Four static event summaries show day numbers (launch is Day 1) and market-cap estimates.
Alpha, Futures and Spot use the event-day daily close. ATH uses the recorded
intraday high of $0.263444 × 1B supply ($263.4M), separate from the chart close.
Chart markers and the four event panels are non-interactive.

Event sources:
- Alpha, 30 July: https://www.binance.com/zh-TC/square/post/07-30-2026-binance-alpha-lists-marscoin-marscoin-341297454259346
- Futures, 1 September 09:45 UTC: https://www.binance.com/en/support/announcement/detail/4d9ae75c02114187b699cfe1380ac81e
- Spot, 4 September 13:00 UTC: https://www.binance.com/en/support/announcement/detail/c2eaa763831745b2b1701dab45e20225
- Price high, 5 September: marscoin-metadata-source.json; details distinguish
  the plotted daily pool close from CoinGecko's recorded intraday high.

Sources retrieved 25 September 2026. Event timing does not establish causation.
