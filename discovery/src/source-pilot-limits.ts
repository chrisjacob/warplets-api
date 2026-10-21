export const SOURCE_PILOT_LIMITS = {
  mints: 10, response_rows: 100, candles: 360, window_seconds: 21_600,
  input_bytes: 1_000_000, record_bytes: 1_900_000, provider_age_seconds: 300,
  proposed_market_daily_subset: 20,
} as const;
