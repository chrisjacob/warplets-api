import type { normalizeGmgnCandles } from "./gmgn-candles";
type Bar = ReturnType<typeof normalizeGmgnCandles>["candles"][number];

// Reproducible dimensional corroboration, not independent trade verification.
// A candle's volume-weighted USD price must lie inside its USD low/high range.
export function corroborateGmgnUnits(bars: Bar[]) {
  let informative = 0, volumeUsd = 0, amountUsd = 0, contradictory = 0;
  for (const bar of bars) {
    if (bar.amount === null || bar.volume === 0 && bar.amount === 0) continue;
    if (bar.volume === 0 || bar.amount === 0) { contradictory++; continue; }
    informative++;
    const within = (price: number) => Number.isFinite(price) && price >= bar.low * .99 && price <= bar.high * 1.01;
    if (within(bar.volume / bar.amount)) volumeUsd++;
    if (within(bar.amount / bar.volume)) amountUsd++;
  }
  const volume = informative >= 12 && !contradictory && volumeUsd === informative && amountUsd === 0;
  const amount = informative >= 12 && !contradictory && amountUsd === informative && volumeUsd === 0;
  const usd = volume ? "volume" as const : amount ? "amount" as const : null;
  return { version: "gmgn-unit-corroboration-v1" as const, state: usd ? "price_consistent" as const : "unknown" as const,
    usd_field: usd, token_field: volume ? "amount" as const : amount ? "volume" as const : null,
    informative_candles: informative, volume_usd_consistent: volumeUsd, amount_usd_consistent: amountUsd, contradictory_flow_pairs: contradictory,
    price_tolerance_pct: 1 as const, minimum_informative_candles: 12 as const, independent_trade_verification: false as const };
}
