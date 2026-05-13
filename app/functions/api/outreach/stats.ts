import { jsonSecure, requireAdminScope } from "../../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  ADMIN_API_KEYS_JSON?: string;
  SECURITY_LOG_SALT?: string;
}

async function countFirst(db: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...binds).first<{ total: number | null }>();
  return Number(row?.total ?? 0);
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:stats" });
  if (!auth.ok) return auth.response;

  const now = Date.now();
  const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    messages24h,
    messages7d,
    messagesTotal,
    recipients24h,
    recipients7d,
    recipientsTotal,
    optOuts24h,
    optOuts7d,
    optOutsTotal,
    optOutsCurrent,
    reachedRecipients,
    avgWarpletRow,
    neverMentioned,
  ] = await Promise.all([
    countFirst(context.env.WARPLETS, "SELECT COUNT(*) AS total FROM warplets_outreach_messages WHERE created_on >= ?", since24h),
    countFirst(context.env.WARPLETS, "SELECT COUNT(*) AS total FROM warplets_outreach_messages WHERE created_on >= ?", since7d),
    countFirst(context.env.WARPLETS, "SELECT COUNT(*) AS total FROM warplets_outreach_messages"),
    countFirst(context.env.WARPLETS, "SELECT COUNT(*) AS total FROM warplets_outreach_recipients WHERE created_on >= ?", since24h),
    countFirst(context.env.WARPLETS, "SELECT COUNT(*) AS total FROM warplets_outreach_recipients WHERE created_on >= ?", since7d),
    countFirst(context.env.WARPLETS, "SELECT COUNT(*) AS total FROM warplets_outreach_recipients"),
    countFirst(context.env.WARPLETS, "SELECT COUNT(*) AS total FROM warplets_outreach_opt_outs WHERE opted_out_on >= ?", since24h),
    countFirst(context.env.WARPLETS, "SELECT COUNT(*) AS total FROM warplets_outreach_opt_outs WHERE opted_out_on >= ?", since7d),
    countFirst(context.env.WARPLETS, "SELECT COUNT(*) AS total FROM warplets_outreach_opt_outs"),
    countFirst(context.env.WARPLETS, "SELECT COUNT(*) AS total FROM warplets_outreach_opt_outs WHERE opted_back_in_on IS NULL"),
    countFirst(context.env.WARPLETS, "SELECT COUNT(DISTINCT recipient_fid) AS total FROM warplets_outreach_recipients"),
    context.env.WARPLETS.prepare(
      "SELECT AVG(COALESCE(outreach_count, 0)) AS average FROM warplets_metadata"
    ).first<{ average: number | null }>(),
    countFirst(context.env.WARPLETS, "SELECT COUNT(*) AS total FROM warplets_metadata WHERE COALESCE(outreach_count, 0) = 0"),
  ]);

  const recentRows = await context.env.WARPLETS.prepare(
    `SELECT
       m.id,
       m.sender_fid,
       m.action_slug,
       m.channel,
       m.verification,
       m.recipient_count,
       m.created_on,
       GROUP_CONCAT(COALESCE(r.farcaster_username, r.x_username), ', ') AS recipients
     FROM warplets_outreach_messages m
     LEFT JOIN warplets_outreach_recipients r
       ON r.message_id = m.id
     GROUP BY m.id
     ORDER BY m.created_on DESC
     LIMIT 25`
  ).all<{
    id: number;
    sender_fid: number;
    action_slug: string;
    channel: string;
    verification: string | null;
    recipient_count: number;
    created_on: string;
    recipients: string | null;
  }>();

  const topOutreached = await context.env.WARPLETS.prepare(
    `SELECT token_id, fid_value, warplet_username_farcaster, warplet_username_x, outreach_count
     FROM warplets_metadata
     ORDER BY outreach_count DESC, token_id ASC
     LIMIT 25`
  ).all<{
    token_id: number;
    fid_value: number | null;
    warplet_username_farcaster: string | null;
    warplet_username_x: string | null;
    outreach_count: number;
  }>();

  return jsonSecure({
    messages: {
      last24h: messages24h,
      last7d: messages7d,
      total: messagesTotal,
    },
    recipients: {
      last24h: recipients24h,
      last7d: recipients7d,
      total: recipientsTotal,
    },
    optOuts: {
      last24h: optOuts24h,
      last7d: optOuts7d,
      total: optOutsTotal,
      current: optOutsCurrent,
    },
    averages: {
      recipientsPerMessage: messagesTotal > 0 ? recipientsTotal / messagesTotal : 0,
      outreachEventsPerReachedRecipient: reachedRecipients > 0 ? recipientsTotal / reachedRecipients : 0,
      warpletOutreachCount: Number(avgWarpletRow?.average ?? 0),
      neverMentionedWarplets: neverMentioned,
    },
    recent: recentRows.results ?? [],
    topOutreached: topOutreached.results ?? [],
  });
};
