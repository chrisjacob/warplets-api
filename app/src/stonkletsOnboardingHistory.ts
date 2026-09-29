// Frozen GeckoTerminal hourly USD closes. Full responses and methodology:
// docs/stonklets-onboarding-history-source.json and stonklets-onboarding-research.md.
export const MARSCOIN_CONTRACT = "0xfe189e97832da1573e4e4ff034f4ffc3a15c7777";
export const SPCXB_CONTRACT = "0xbe9d156892e55e7154bcd3cb0fea677f9d3103e1";
export const MARSCOIN_POOL = "0x94f3ed36706c746ad59fadcaf271b7431ab1d8f1";
export const MARSCOIN_MILESTONES = [
  { id: "baseline", label: "Launch baseline", date: "27 Jul · 15:00 UTC", candleStart: 1785160800, mars: 0.000510349355354238, spcxb: 110.235632252118 },
  { id: "listing", label: "Spot opens", date: "4 Sep · 13:00 UTC", candleStart: 1788523200, mars: 0.176849576899212, spcxb: 148.070667874823 },
  { id: "after24h", label: "24h after Spot", date: "5 Sep · 13:00 UTC", candleStart: 1788609600, mars: 0.247730585076766, spcxb: 149.609482732555 },
] as const;
export function historicalReturn(price: number, baseline: number): number {
  return (price / baseline - 1) * 100;
}
export function formatHistoricalReturn(value: number): string {
  return `${value > 0 ? "+" : ""}${Math.round(value).toLocaleString("en-US")}%`;
}
