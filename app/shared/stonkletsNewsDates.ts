/** Eleven calendar months, with month-end clamping and UTC day precision. */
export function newsHistoryCutoff(now: number): number {
  const date = new Date(now), day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 11);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}
export function newsPublicationLabel(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const day = date.getUTCDate(), tens = day % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th";
  return `${day}${suffix} ${date.toLocaleString("en-GB", { month: "long", timeZone: "UTC" })}`;
}
