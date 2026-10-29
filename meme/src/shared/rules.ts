export const ATTRIBUTES = [
  "cast",
  "fid",
  "follower",
  "holder",
  "luck",
  "minter",
  "neynar",
  "nft",
  "token",
  "volume",
] as const;
export type Attribute = (typeof ATTRIBUTES)[number];
export const RULES_VERSION = "local-v1";
export const DAY_MS = 86400000;
export function dailyTimes(day: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    new Date(day + "T00:00:00Z").toISOString().slice(0, 10) !== day
  )
    throw Error("Invalid UTC date");
  const target = Date.parse(day + "T20:00:00Z");
  return {
    opensAt: target - DAY_MS,
    closesAt: target - 1800000,
    freezeBy: target - DAY_MS - 300000,
    launchTarget: target,
  };
}
