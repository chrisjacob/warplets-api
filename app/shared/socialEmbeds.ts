import { safeSocialUrl } from "./social.js";

export interface CastPreview {
  hash: string;
  username: string;
  avatar: string | null;
  text: string;
  embeds: string[];
  createdAt: number;
}

export function mediaKind(raw: string): {
  kind: "youtube" | "tweet" | "cast" | "image" | "video" | "link";
  id?: string;
} {
  const safe = safeSocialUrl(raw);
  if (!safe) return { kind: "link" };
  const url = new URL(safe);
  const host = url.hostname.replace(/^www\./, "");
  const youtube =
    host === "youtu.be"
      ? url.pathname.slice(1)
      : ["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)
        ? url.searchParams.get("v") ||
          url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1]
        : null;
  if (youtube && /^[\w-]{11}$/.test(youtube))
    return { kind: "youtube", id: youtube };
  const tweet = [
    "x.com",
    "twitter.com",
    "mobile.twitter.com",
    "mobile.x.com",
  ].includes(host)
    ? url.pathname.match(/^\/(?:[\w]+\/status|i\/web\/status)\/(\d+)/)?.[1]
    : null;
  if (tweet) return { kind: "tweet", id: tweet };
  if (
    ["farcaster.xyz", "warpcast.com"].includes(host) &&
    /^\/(?:~\/conversations|[\w.-]+)\/0x[\da-f]{8,40}\/?$/i.test(url.pathname)
  )
    return { kind: "cast" };
  if (
    ["social.10x.meme", "social-local.10x.meme", "10x.social"].includes(host) &&
    /^\/(?:social\/)?post\/[\w-]+$/.test(url.pathname)
  )
    return { kind: "cast" };
  if (/\.(mp4|webm|m3u8)$/i.test(url.pathname)) return { kind: "video" };
  if (
    /\.(png|jpe?g|gif|webp|avif)$/i.test(url.pathname) ||
    /(^|\.)(imagedelivery\.net|wrpcd\.net)$/.test(host) ||
    host.startsWith("images.")
  )
    return { kind: "image" };
  return { kind: "link" };
}

export function socialMediaUrls(text: string, embeds: string[]): string[] {
  const links = (text.match(/https?:\/\/[^\s<>]+/g) ?? [])
    .map((url) => url.replace(/[.,!;:)]+$/, ""))
    .filter((url) =>
      ["tweet", "youtube", "cast"].includes(mediaKind(url).kind),
    );
  return [
    ...new Set(
      [...embeds, ...links].map(safeSocialUrl).filter((s): s is string => !!s),
    ),
  ].slice(0, 4);
}
