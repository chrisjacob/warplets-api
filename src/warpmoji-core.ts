export const WARPMOJI_SCORING_VERSION = "warpmoji-v1";
export const WARPMOJI_HARD_DAILY_REPLY_LIMIT = 900;
export const WARPMOJI_RECENT_SELECTION_WINDOW = 3;

export type WarpmojiChannel = "farcaster" | "telegram" | "discord" | "warpmoji_api";
export type WarpmojiTrigger = "organic" | "mention" | "emoji" | "command" | "api";

const ALLOWED_ATTRIBUTION: Readonly<Record<WarpmojiChannel, readonly WarpmojiTrigger[]>> = {
  farcaster: ["organic", "mention"],
  telegram: ["emoji", "command"],
  discord: ["emoji", "command"],
  warpmoji_api: ["api"],
};

export function codePoints(value: string): string {
  return [...value].map((part) => part.codePointAt(0)?.toString(16).toUpperCase()).join("-");
}

export function removeEmojiPresentation(value: string): string {
  return value.replace(/\uFE0F/g, "");
}

export function isExactEmojiAlias(input: string, aliases: ReadonlySet<string>): boolean {
  const normalized = input.trim().normalize("NFC");
  return normalized.length > 0 && aliases.has(normalized);
}

export function stripMentionByRanges(
  text: string,
  mentionPositions: readonly number[],
  mentionLengths: readonly number[],
): string {
  if (!mentionPositions.length || mentionPositions.length !== mentionLengths.length) return text.trim();
  const codepoints = [...text];
  const removed = new Set<number>();
  for (let index = 0; index < mentionPositions.length; index += 1) {
    const start = Math.max(0, mentionPositions[index]);
    const end = Math.min(codepoints.length, start + Math.max(0, mentionLengths[index]));
    for (let offset = start; offset < end; offset += 1) removed.add(offset);
  }
  return codepoints.filter((_, index) => !removed.has(index)).join("").trim();
}

export function isAllowedAttribution(channel: string, trigger: string): channel is WarpmojiChannel {
  return channel in ALLOWED_ATTRIBUTION && ALLOWED_ATTRIBUTION[channel as WarpmojiChannel].includes(trigger as WarpmojiTrigger);
}

export function buildWarpmojiUrl(input: {
  origin?: string;
  tokenId: number;
  emoji: string;
  channel: WarpmojiChannel;
  trigger: WarpmojiTrigger;
}): string {
  if (!Number.isInteger(input.tokenId) || input.tokenId < 1 || input.tokenId > 10_000) {
    throw new Error("Warpmoji token ID must be between 1 and 10,000");
  }
  if (!isAllowedAttribution(input.channel, input.trigger)) throw new Error("Invalid Warpmoji attribution pair");
  const url = new URL("/", (input.origin ?? "https://warplet.10x.meme").replace(/\/$/, ""));
  url.searchParams.set("warplet", String(input.tokenId));
  url.searchParams.set("emoji", input.emoji);
  url.searchParams.set("utm_source", input.channel);
  url.searchParams.set("utm_medium", input.channel === "warpmoji_api" ? "bot" : "social");
  url.searchParams.set("utm_campaign", "warpmoji");
  url.searchParams.set("utm_content", input.trigger);
  return url.toString();
}

export function nextRetryAt(attempt: number, now = Date.now()): string {
  const seconds = Math.min(3600, 2 ** Math.max(0, attempt) * 15);
  return new Date(now + seconds * 1000).toISOString();
}

export function evaluateWarpmojiCaps(input: {
  classification: "organic" | "mention";
  userCount: number;
  categoryCount: number;
  combinedCount: number;
  organicUser: number;
  organicDaily: number;
  mentionUser: number;
  mentionDaily: number;
  combinedDaily: number;
}): string | null {
  const userCap = input.classification === "mention" ? input.mentionUser : input.organicUser;
  const categoryCap = input.classification === "mention" ? input.mentionDaily : input.organicDaily;
  if (input.userCount >= userCap) return `${input.classification}_user_cap`;
  if (input.categoryCount >= categoryCap) return `${input.classification}_daily_cap`;
  if (input.combinedCount >= Math.min(input.combinedDaily, WARPMOJI_HARD_DAILY_REPLY_LIMIT)) return "combined_daily_cap";
  return null;
}
