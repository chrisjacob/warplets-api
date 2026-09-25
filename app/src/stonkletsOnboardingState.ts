export const STONKLETS_ONBOARDING_KEY = "10x:stonklets:onboarding:v1";
// Matching hourly USD closes and raw provider responses are checked into docs/.
export const STONKLETS_ONBOARDING_RELEASE_READY = true;

export function onboardingComplete(storage: Pick<Storage, "getItem"> | null): boolean {
  try { return storage?.getItem(STONKLETS_ONBOARDING_KEY) === "1"; } catch { return false; }
}
export function completeOnboarding(storage: Pick<Storage, "setItem"> | null): void {
  try { storage?.setItem(STONKLETS_ONBOARDING_KEY, "1"); } catch { /* Current mount still completes. */ }
}
export function onboardingStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
export function firstStonkletsDialog(onboarding: boolean, notice: boolean, notifications: boolean) {
  return onboarding ? "onboarding" : notice ? "notice" : notifications ? "notifications" : null;
}

// Percentage returns, not prices. Both share the same linear chart scale.
export const HOOD_SCENARIO = [0, 3, 8, 6, 12, 19, 17, 25, 31, 28, 38, 44, 40, 51, 57, 53, 65, 72, 68, 80, 87, 83, 94, 100];
export const ARROW_SCENARIO = [0, 35, -55, 95, 180, 40, 260, 105, 390, 170, 510, 220, 650, 360, 780, 410, 910, 520, 740, 440, 980, 670, 850, 1000];
export function scenarioValue(series: readonly number[], progress: number): number {
  const position = Math.max(0, Math.min(1, progress)) * (series.length - 1);
  const index = Math.floor(position);
  return series[index]! + ((series[Math.min(index + 1, series.length - 1)]! - series[index]!) * (position - index));
}

// Compare calendar dates in the visitor's timezone, using UTC arithmetic to
// avoid daylight-saving days being rounded incorrectly.
export function marketAgeDays(start: string, today = new Date()): number {
  const currentDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.floor((currentDay - Date.parse(`${start}T00:00:00Z`)) / 86_400_000));
}
