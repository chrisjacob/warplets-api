# Stonklets onboarding historical comparison

Verified 2026-09-22 (Australia/Sydney). Raw responses, exact request URLs and retrieval
UTC timestamps are preserved in `stonklets-onboarding-history-source.json`.

## Identity and time basis

- MarsCoin on BNB Chain: `0xfe189e97832da1573e4e4ff034f4ffc3a15c7777`.
- SPCXB: `0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1`.
- Original pool: `0x94f3ed36706c746ad59fadcaf271b7431ab1d8f1`.
- GeckoTerminal token-pools lookup reported pool creation **2026-07-27 13:23:11 UTC**.
- Baseline is the **close of the first full hourly pool candle**, July 27 14:00?15:00 UTC.
  It is not the first trade, issuance price, or an assumed executable entry price.
- Binance Spot opening: September 4, 2026 13:00 UTC; use the 12:00?13:00 candle close.
- Endpoint: September 5, 2026 13:00 UTC; use the 12:00?13:00 candle close, exactly
  24h after opening. This is not described as the peak or as caused by the listing.

The OHLCV endpoint supports explicit token contract addresses. All six accepted requests
use addresses, avoiding base/quote ordering ambiguity. Each response's `meta.base.address`
matches the requested asset. Candle timestamps denote interval opens; adjacent candle
opens also match the preceding closes. Array position 4 is the close, in USD.

## Preserved values and independent calculation

| Candle close (UTC, 2026) | MarsCoin USD | SPCXB USD | MarsCoin gain | SPCXB gain |
|---|---:|---:|---:|---:|
| July 27 15:00 | 0.000510349355354238 | 110.235632252118 | 0% | 0% |
| September 4 13:00 | 0.176849576899212 | 148.070667874823 | 34552.6501981097% | 34.3219654568% |
| September 5 13:00 | 0.247730585076766 | 149.609482732555 | 48441.3731746196% | 35.7178978122% |

Formula per asset: `(milestoneClose / baselineClose - 1) * 100`.
Python Decimal recalculation and the TypeScript provenance tests independently check
these results. UI rounds to whole percentages: +34,553%/+34% at listing and
+48,441%/+36% at +24h. These are historical pool price changes, not realizable investor
returns; exclude taxes, trading fees, slippage and holder rewards. SPCXB is a tokenized
SpaceX-linked asset, not a direct measurement of SpaceX equity. These data establish
price outperformance for this selected window, not causation or a forecast.

## Sources

- Pool identity/creation: https://api.geckoterminal.com/api/v2/networks/bsc/tokens/0xfe189e97832da1573e4e4ff034f4ffc3a15c7777/pools
- All six hourly price URLs and complete responses: companion JSON file.
- OHLCV schema, currency, token-address selector: https://docs.coingecko.com/reference/pool-ohlcv-contract-address
- Candle opening timestamp convention: https://docs.coingecko.com/websocket/wssonchainohlcv
- Spot opening and Alpha transition: https://www.binance.com/en/support/announcement/detail/c2eaa763831745b2b1701dab45e20225
- Tax and pairing: https://marscoin.today/ identifies MARS/SPCXB and states 3% buy / 3% sell tax funding holder rewards. These are on-chain taxes, not centralized exchange fees.

Initial historical requests encountered 403/429 errors; retries succeeded. No failed
responses or guessed values are used in the final dataset. History is bundled locally;
onboarding performs no history API requests. Slide 5 is separately labelled illustrative
and deliberately uses fictional HOODB +100% / ARROW10X +1,000% paths.

Browser visual/interaction QA remains required when a browser surface is available.
