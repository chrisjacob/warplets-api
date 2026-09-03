export const STONKLET_CHANGE_RANGES = ["1h", "24h", "7d", "30d", "60d", "90d", "all"] as const;

export type StonkletChangeRange = (typeof STONKLET_CHANGE_RANGES)[number];

export const DEFAULT_STONKLET_CHANGE_RANGE: StonkletChangeRange = "24h";

export const STONKLET_CHANGE_RANGE_LABELS: Record<StonkletChangeRange, string> = {
  "1h": "1h",
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  "60d": "60d",
  "90d": "90d",
  all: "All Time",
};

export function parseStonkletChangeRange(value: string | null | undefined): StonkletChangeRange | null {
  return value && (STONKLET_CHANGE_RANGES as readonly string[]).includes(value) ? value as StonkletChangeRange : null;
}

export function stonkletChangeRangeSeconds(range: StonkletChangeRange): number | null {
  if (range === "all") return null;
  const hours: Record<Exclude<StonkletChangeRange, "all">, number> = {
    "1h": 1,
    "24h": 24,
    "7d": 7 * 24,
    "30d": 30 * 24,
    "60d": 60 * 24,
    "90d": 90 * 24,
  };
  return hours[range] * 60 * 60;
}

export function stonkletRangeCacheSeconds(range: StonkletChangeRange): number {
  if (range === "1h") return 60;
  if (range === "24h" || range === "7d") return 5 * 60;
  if (range === "all") return 6 * 60 * 60;
  return 15 * 60;
}
