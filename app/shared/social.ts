import { STONKLET_TRADE_DESTINATIONS } from "./stonkletsTrading";
export const SOCIAL_APP_SLUG = "social" as const;
export const SOCIAL_NAME = "10X Social";
export const SOCIAL_HOSTS = [
  "social.10x.meme",
  "social-local.10x.meme",
] as const;
export const SOCIAL_DESCRIPTION =
  "One focused daily feed where posts receive a real chance to be seen and go viral.";
export const DAY = 86_400_000;
export type SocialAction =
  | "visit"
  | "checkin"
  | "post"
  | "like"
  | "comment"
  | "quote"
  | "recast"
  | "explore";
export interface SocialConfig {
  points: Record<SocialAction, number>;
  limits: Record<SocialAction, number>;
  boosts: {
    connection: number;
    context: number;
    notifications: number;
    signer: number;
    follow: number;
    email: number;
    actionCap: number;
    streakStep: number;
    streakCap: number;
    warpletStep: number;
    warpletCap: number;
    stonkletStep: number;
    stonkletCap: number;
    maximum: number;
    rankingMaximum: number;
  };
  stonklets: Array<{
    name: string;
    address: string;
    chainId: number;
    decimals: number;
    minimum: string;
  }>;
  followFid: number;
  referralUrl: string;
  miniAppUrl: string;
  ingestionEnabled: boolean;
  requestsPerRun: number;
}
export const DEFAULT_SOCIAL_CONFIG: SocialConfig = {
  points: {
    visit: 5,
    checkin: 10,
    post: 20,
    like: 1,
    comment: 3,
    quote: 5,
    recast: 2,
    explore: 1,
  },
  limits: {
    visit: 1,
    checkin: 1,
    post: 1,
    like: 20,
    comment: 10,
    quote: 5,
    recast: 10,
    explore: 20,
  },
  boosts: {
    connection: 0.5,
    context: 0.25,
    notifications: 0.25,
    signer: 0.5,
    follow: 0.5,
    email: 0.5,
    actionCap: 2.5,
    streakStep: 0.25,
    streakCap: 2.5,
    warpletStep: 0.25,
    warpletCap: 2.5,
    stonkletStep: 0.25,
    stonkletCap: 2.5,
    maximum: 10,
    rankingMaximum: 2,
  },
  stonklets: Object.entries(STONKLET_TRADE_DESTINATIONS).map(
    ([name, address]) => ({
      name,
      address,
      chainId: 56,
      decimals: 18,
      minimum: "10000",
    }),
  ),
  followFid: 1313340,
  referralUrl: "https://farcaster.xyz/~/code/1Y7636",
  miniAppUrl:
    "https://farcaster.xyz/~/mini-apps/launch?url=https%3A%2F%2Fsocial.10x.meme",
  ingestionEnabled: false,
  requestsPerRun: 10,
};
export interface BoostEvidence {
  connection: boolean;
  context: boolean;
  notifications: boolean;
  signer: boolean;
  follow: boolean;
  email: boolean;
  streak: number;
  warpletLevel: number;
  stonklets: number;
}
export function calculateBoost(c: SocialConfig, e: BoostEvidence) {
  const b = c.boosts;
  const actions = Math.min(
    b.actionCap,
    (
      [
        "connection",
        "context",
        "notifications",
        "signer",
        "follow",
        "email",
      ] as const
    ).reduce((n, key) => n + (e[key] ? b[key] : 0), 0),
  );
  const contributions = {
    actions,
    streak: Math.min(b.streakCap, Math.max(0, e.streak) * b.streakStep),
    warplets: Math.min(
      b.warpletCap,
      Math.max(0, e.warpletLevel) * b.warpletStep,
    ),
    stonklets: Math.min(
      b.stonkletCap,
      Math.min(10, Math.max(0, e.stonklets)) * b.stonkletStep,
    ),
  };
  const multiplier = Math.min(
    b.maximum,
    1 + Object.values(contributions).reduce((a, v) => a + v, 0),
  );
  return {
    multiplier,
    ranking:
      1 +
      (b.maximum > 1 ? (multiplier - 1) / (b.maximum - 1) : 0) *
        (b.rankingMaximum - 1),
    contributions,
  };
}
export function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}
export function nextStreak(
  previousDay: string | null,
  previousStreak: number,
  now = Date.now(),
) {
  return previousDay === utcDay(now)
    ? previousStreak
    : previousDay === utcDay(now - DAY)
      ? previousStreak + 1
      : 1;
}
export function trendScore(
  engagement: number,
  created: number,
  rank = 1,
  now = Date.now(),
) {
  return (
    ((1 + Math.max(0, engagement)) /
      Math.pow(Math.max(0, (now - created) / 3_600_000) + 2, 1.5)) *
    rank
  );
}
export function safeSocialUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function validateSocialConfig(value: unknown): SocialConfig {
  if (!value || typeof value !== "object")
    throw new Error("Invalid configuration");
  const c = value as SocialConfig;
  for (const group of ["points", "limits", "boosts"] as const) {
    for (const key of Object.keys(DEFAULT_SOCIAL_CONFIG[group])) {
      const n = (c[group] as unknown as Record<string, number>)?.[key];
      if (
        typeof n !== "number" ||
        !Number.isFinite(n) ||
        n < 0 ||
        n > (group === "boosts" ? 10 : 1000)
      )
        throw new Error(`Invalid ${group}.${key}`);
      if (group === "limits" && !Number.isInteger(n))
        throw new Error("Limits must be integers");
    }
  }
  if (
    c.boosts.maximum < 1 ||
    c.boosts.rankingMaximum < 1 ||
    c.limits.post !== 1 ||
    c.limits.checkin !== 1 ||
    c.limits.visit !== 1
  )
    throw new Error("Posting, visit and check-in limits must remain one");
  if (
    !Number.isSafeInteger(c.followFid) ||
    c.followFid < 1 ||
    !safeSocialUrl(c.referralUrl) ||
    !safeSocialUrl(c.miniAppUrl)
  )
    throw new Error("Invalid Farcaster configuration");
  if (
    typeof c.ingestionEnabled !== "boolean" ||
    !Number.isInteger(c.requestsPerRun) ||
    c.requestsPerRun < 1 ||
    c.requestsPerRun > 50
  )
    throw new Error("Invalid ingestion budget");
  if (!Array.isArray(c.stonklets) || c.stonklets.length > 100)
    throw new Error("Invalid assets");
  const addresses = new Set<string>();
  for (const a of c.stonklets) {
    if (
      !a.name ||
      a.name.length > 60 ||
      !/^0x[a-fA-F0-9]{40}$/.test(a.address) ||
      ![56, 8453].includes(a.chainId) ||
      !Number.isInteger(a.decimals) ||
      a.decimals < 0 ||
      a.decimals > 36 ||
      !/^\d+(\.\d+)?$/.test(a.minimum) ||
      Number(a.minimum) <= 0 ||
      (a.minimum.split(".")[1]?.length ?? 0) > a.decimals
    )
      throw new Error("Invalid asset threshold");
    const key = `${a.chainId}:${a.address.toLowerCase()}`;
    if (addresses.has(key)) throw new Error("Duplicate asset");
    addresses.add(key);
  }
  return c;
}
export interface SocialPost {
  id: string;
  member_id: string;
  username: string;
  avatar: string | null;
  fid: number | null;
  text: string;
  embeds: string[];
  cast_hash: string | null;
  created_at: number;
  submitted_at: number | null;
  kind: string;
  likes: number;
  comments: number;
  recasts: number;
  points: number;
  rank: number;
  section?: string;
}
