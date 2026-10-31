/** Presentation only. Allocation/token accounting continues to use exact raw units. */
export function metric(value: string | number | null | undefined, places = 2) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: places })
    : "—";
}
export function percentage(value: string | null) {
  return value === null || !Number.isFinite(Number(value))
    ? "—"
    : (Number(value) > 0 ? "+" : "") + metric(value) + "%";
}
export function direction(value: string | null | undefined) {
  return value == null || !Number.isFinite(Number(value))
    ? ""
    : Number(value) > 0
      ? "positive"
      : Number(value) < 0
        ? "negative"
        : "";
}
