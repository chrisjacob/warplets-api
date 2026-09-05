export interface DailyTopToken {
  id: string;
  asset: "stock" | "stonklet";
  symbol: string;
  change: number | null;
  marketCap: number | null;
}

export function selectDailyTopTokens(tokens: readonly DailyTopToken[]): DailyTopToken[] {
  const cap = (token: DailyTopToken) => token.marketCap != null && Number.isFinite(token.marketCap) && token.marketCap > 0 ? token.marketCap : Infinity;
  return tokens.filter((token) => token.change != null && Number.isFinite(token.change))
    .sort((a, b) => b.change! - a.change!
      || (a.asset === b.asset ? 0 : a.asset === "stonklet" ? -1 : 1)
      || (a.asset === "stonklet" && b.asset === "stonklet" ? cap(a) - cap(b) : 0)
      || a.symbol.localeCompare(b.symbol) || a.id.localeCompare(b.id))
    .slice(0, 3);
}

export function dailyTopBody(tokens: readonly DailyTopToken[]): string {
  return `Daily Top ${tokens.length}: ${tokens.map((token) => {
    const value = token.change!;
    const magnitude = Math.abs(value);
    // Preserve the sign of small gains/losses without ever rounding to -0%.
    const percent = magnitude > 0 && magnitude < 0.01 ? "<0.01" : magnitude >= 1e9 ? magnitude.toExponential(1) : Number(magnitude.toFixed(2)).toString();
    return `${value < 0 ? "-" : "+"}${percent}% $${token.symbol}.`;
  }).join(" ")}`;
}

// NYSE published cash-equity calendar, reviewed September 2026:
// https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/
const holidays: Record<string, string[]> = {
  "2026": ["01-01", "01-19", "02-16", "04-03", "05-25", "06-19", "07-03", "09-07", "11-26", "12-25"],
  "2027": ["01-01", "01-18", "02-15", "03-26", "05-31", "06-18", "07-05", "09-06", "11-25", "12-24"],
  "2028": ["01-17", "02-21", "04-14", "05-29", "06-19", "07-04", "09-04", "11-23", "12-25"],
};
const earlyCloses = new Set(["2026-11-27", "2026-12-24", "2027-11-26", "2028-07-03", "2028-11-24"]);

export function dailyTopDate(now: Date): string | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  const calendar = holidays[part("year")];
  if (!calendar) throw new Error("NYSE notification calendar needs updating for this year");
  const monthDay = `${part("month")}-${part("day")}`;
  if (["Sat", "Sun"].includes(part("weekday")) || calendar.includes(monthDay)) return null;
  const date = `${part("year")}-${monthDay}`;
  return Number(part("hour")) >= (earlyCloses.has(date) ? 13 : 16) ? date : null;
}
