import {
  mediaKind,
  socialMediaUrls,
  type CastPreview,
} from "../../shared/socialEmbeds.js";
import { safeSocialUrl } from "../../shared/social.js";
import { neynar, type Cast } from "./socialProvider.js";
import { SocialError, type SocialEnv } from "./socialStore.js";
import { rateLimit } from "./security.js";

export function castPreview(cast: Cast): CastPreview {
  if (
    !cast?.author?.fid ||
    !/^0x[\da-f]{40}$/i.test(cast.hash) ||
    typeof cast.text !== "string"
  )
    throw new SocialError("Cast unavailable", 404);
  return {
    hash: cast.hash,
    username: cast.author.username || `fid:${cast.author.fid}`,
    avatar: safeSocialUrl(cast.author.pfp_url),
    text: cast.text.slice(0, 10000),
    createdAt: Date.parse(cast.timestamp),
    embeds: socialMediaUrls(
      "",
      (cast.embeds ?? []).flatMap((e) => (e.url ? [e.url] : [])),
    ),
  };
}

// Only resolve cast links actually attached to a visible local post. Do not crawl
// or ingest arbitrary URLs, allocate rewards, or add previews to the daily feed.
export async function resolveCastEmbed(
  env: SocialEnv,
  parent: { text: string; embeds_json: string; raw_json?: string },
  raw: string,
  ip: string,
) {
  const url = safeSocialUrl(raw);
  if (
    !url ||
    mediaKind(url).kind !== "cast" ||
    !socialMediaUrls(parent.text, JSON.parse(parent.embeds_json)).includes(url)
  )
    throw new SocialError("Invalid cast attachment");
  const parsed = new URL(url);
  const id = parsed.pathname.split("/").filter(Boolean).at(-1)!;
  const local = await env.WARPLETS.prepare(
    "SELECT p.*,m.username,m.avatar,m.status AS member_status FROM social_posts p JOIN social_members m ON m.id=p.member_id WHERE p.id=?",
  )
    .bind(id)
    .first<{
      id: string;
      username: string;
      avatar: string | null;
      text: string;
      embeds_json: string;
      created_at: number;
      status: string;
      member_status: string;
    }>();
  if (local) {
    if (local.status !== "visible" || local.member_status !== "active")
      throw new SocialError("Cast unavailable", 404);
    return {
      hash: local.id,
      username: local.username,
      avatar: local.avatar,
      text: local.text,
      embeds: JSON.parse(local.embeds_json),
      createdAt: local.created_at,
    } satisfies CastPreview;
  }
  if (
    !["farcaster.xyz", "warpcast.com"].includes(
      parsed.hostname.replace(/^www\./, ""),
    )
  )
    throw new SocialError("Post unavailable", 404);
  let embedded: Cast | undefined;
  try {
    const stored = JSON.parse(parent.raw_json || "{}");
    embedded = stored.embeds?.find(
      (e: { cast?: Cast }) => e.cast?.hash?.toLowerCase() === id.toLowerCase(),
    )?.cast;
  } catch {
    /* Older imports may have no provider payload. */
  }
  const key = `social:cast-preview:v1:${url}`;
  const cached = embedded
    ? null
    : await env.WARPLETS_KV?.get<Cast>(key, "json");
  let cast = embedded || cached;
  if (!cast) {
    const limited = await rateLimit(
      env.WARPLETS_KV,
      "social-embed",
      ip,
      30,
      60,
    );
    if (!limited.allowed) throw new SocialError("Please retry shortly", 429);
    const identifier = /^0x[\da-f]{40}$/i.test(id) ? id : url;
    cast = (
      await neynar<{ cast: Cast }>(
        env,
        `cast?identifier=${encodeURIComponent(identifier)}&type=${identifier === id ? "hash" : "url"}`,
      )
    ).cast;
    castPreview(cast);
    await env.WARPLETS_KV?.put(key, JSON.stringify(cast), {
      expirationTtl: 3600,
    });
  }
  const blocked = await env.WARPLETS.prepare(
    "SELECT 1 FROM social_identities i JOIN social_members m ON m.id=i.member_id WHERE i.identity=? AND m.status!='active' LIMIT 1",
  )
    .bind(`fid:${cast.author.fid}`)
    .first();
  if (blocked) throw new SocialError("Cast unavailable", 404);
  const hidden = await env.WARPLETS.prepare(
    "SELECT 1 FROM social_posts WHERE cast_hash=? AND status!='visible' LIMIT 1",
  )
    .bind(cast.hash)
    .first();
  if (hidden) throw new SocialError("Cast unavailable", 404);
  return castPreview(cast);
}
