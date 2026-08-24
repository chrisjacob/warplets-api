import { jsonSecure } from "../../_lib/security.js";

interface Env { WARPLETS: D1Database }
const ATTRIBUTION: Record<string, readonly string[]> = {
  farcaster: ["organic", "mention"], telegram: ["emoji", "command"], discord: ["emoji", "command"], warpmoji_api: ["api"],
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return jsonSecure({ error: "cross-origin request rejected" }, { status: 403 });
  const body = await request.json<{ source?: unknown; trigger?: unknown; emoji?: unknown; tokenId?: unknown }>().catch(() => ({} as { source?: unknown; trigger?: unknown; emoji?: unknown; tokenId?: unknown }));
  const source = typeof body.source === "string" ? body.source : "";
  const trigger = typeof body.trigger === "string" ? body.trigger : "";
  const emoji = typeof body.emoji === "string" ? body.emoji.trim().normalize("NFC") : "";
  const tokenId = Number(body.tokenId);
  if (!ATTRIBUTION[source]?.includes(trigger) || !emoji || !Number.isInteger(tokenId) || tokenId < 1 || tokenId > 10000) return jsonSecure({ error: "invalid Warpmoji attribution" }, { status: 400 });
  const approved = await env.WARPLETS.prepare(
    `SELECT a.canonical_emoji FROM warpmoji_emoji_aliases a JOIN warpmoji_candidates c ON c.canonical_emoji = a.canonical_emoji
      WHERE a.alias = ? AND c.token_id = ? AND c.status = 'approved' LIMIT 1`,
  ).bind(emoji, tokenId).first<{ canonical_emoji: string }>();
  if (!approved) return jsonSecure({ error: "invalid Warpmoji match" }, { status: 400 });
  await env.WARPLETS.prepare(
    `INSERT INTO warpmoji_attribution_daily (day, source, trigger, canonical_emoji, token_id, opens)
     VALUES (date('now'), ?, ?, ?, ?, 1)
     ON CONFLICT(day, source, trigger, canonical_emoji, token_id) DO UPDATE SET opens = opens + 1`,
  ).bind(source, trigger, approved.canonical_emoji, tokenId).run();
  return jsonSecure({ ok: true });
};
