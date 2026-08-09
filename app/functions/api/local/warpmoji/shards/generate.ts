import { buildWarpmojiRegexShards } from "../../../../../shared/warpmojiRegex.js";
import { auditWarpmoji, requireWarpmojiAdmin, type WarpmojiAdminEnv } from "../../../../_lib/warpmojiAdmin.js";
import { jsonSecure } from "../../../../_lib/security.js";

export const onRequestPost: PagesFunction<WarpmojiAdminEnv> = async ({ request, env }) => {
  const admin = await requireWarpmojiAdmin(request, env, { mutation: true });
  if (admin instanceof Response) return admin;
  const aliases = await env.WARPLETS.prepare(
    `SELECT DISTINCT a.alias FROM warpmoji_emoji_aliases a
      WHERE EXISTS (SELECT 1 FROM warpmoji_candidates c WHERE c.canonical_emoji = a.canonical_emoji AND c.status = 'approved')
      ORDER BY a.alias`,
  ).all<{ alias: string }>();
  const shards = buildWarpmojiRegexShards(aliases.results.map((row) => row.alias), 75);
  const statements = [env.WARPLETS.prepare("DELETE FROM warpmoji_webhook_shards WHERE kind IN ('organic','mention')")];
  shards.forEach((regex, index) => statements.push(env.WARPLETS.prepare("INSERT INTO warpmoji_webhook_shards (id, kind, alias_count, regex_text, status) VALUES (?, 'organic', ?, ?, 'pending')").bind(`organic-${String(index + 1).padStart(3, "0")}`, Math.min(75, aliases.results.length - index * 75), regex)));
  statements.push(env.WARPLETS.prepare("INSERT INTO warpmoji_webhook_shards (id, kind, alias_count, status) VALUES ('mention-001', 'mention', ?, 'pending')").bind(aliases.results.length));
  await env.WARPLETS.batch(statements);
  await auditWarpmoji(env.WARPLETS, admin.fid, "shards.generate", "approved-aliases", { aliases: aliases.results.length, shards: shards.length });
  return jsonSecure({ ok: true, aliases: aliases.results.length, organicShards: shards.length, shardSize: 75, synced: false });
};
