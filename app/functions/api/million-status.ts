interface Env {
  WARPLETS: D1Database;
  WARPLETS_KV?: KVNamespace;
  ACTION_SESSION_SECRET?: string;
  ALLOW_INSECURE_ACTION_FID_FALLBACK?: string;
}
import { createActionSessionToken, jsonSecure, verifyActionSessionToken } from "../_lib/security.js";

type ActionRow = {
  id: number;
  slug: string;
  name: string;
  description: string;
  app_action: string | null;
  url: string | null;
  verification_method: string;
  entry_value: number;
};

type ActionCompletionRow = {
  action_slug: string;
  verification: string | null;
};

function currentGiveawayMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysLeftInUtcMonth(now = new Date()): number {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const ms = Math.max(0, end - now.getTime());
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

function asPositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function resolveFid(context: EventContext<Env, string, unknown>): Promise<number | null> {
  const url = new URL(context.request.url);
  const token = url.searchParams.get("sessionToken")?.trim() || null;
  const session = await verifyActionSessionToken(context.env.ACTION_SESSION_SECRET, token);
  if (session.valid) return session.fid;

  const isLocalDevHost =
    url.hostname.includes("-local.") ||
    url.hostname.includes("-dev.") ||
    url.hostname.endsWith(".pages.dev") ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "::1";
  if (!isLocalDevHost && context.env.ALLOW_INSECURE_ACTION_FID_FALLBACK !== "1") return null;
  return asPositiveInt(url.searchParams.get("fid"));
}

async function loadActions(db: D1Database): Promise<ActionRow[]> {
  const result = await db.prepare(
    `SELECT id, slug, name, description, app_action, url, verification_method, entry_value
     FROM actions
     WHERE app_slug = 'million'
     ORDER BY CASE slug
       WHEN 'million-enter-email' THEN 1
       WHEN 'million-cast' THEN 2
       WHEN 'million-tweet' THEN 3
       WHEN 'million-follow-fc-10xmeme' THEN 4
       WHEN 'million-follow-fc-10xchris' THEN 5
       WHEN 'million-follow-x-10xmeme' THEN 6
       WHEN 'million-follow-x-10xchris' THEN 7
       WHEN 'million-join-fc-channel' THEN 8
       WHEN 'million-join-telegram' THEN 9
       ELSE 999
     END, id ASC`
  ).all<ActionRow>();
  return result.results ?? [];
}

async function loadEntryAvatars(db: D1Database, giveawayMonth: string, fid: number | null, useQa: boolean) {
  if (useQa) {
    const result = await db.prepare(
      `SELECT token_id, name, image_url
       FROM warplets_metadata
       WHERE image_url IS NOT NULL
       ORDER BY token_id ASC
       LIMIT 10`
    ).all<{ token_id: number; name: string; image_url: string }>();
    return (result.results ?? []).map((row) => ({
      fid: row.token_id,
      username: row.name,
      pfpUrl: row.image_url,
    }));
  }

  if (fid) {
    const best = await db.prepare(
      `SELECT wu.fid, wu.username, wu.pfp_url
       FROM million_giveaway_entries e
       JOIN warplets_users wu ON wu.id = e.user_id
       JOIN warplets_user_best_friends bf ON bf.best_friend_fid = wu.fid
       WHERE e.giveaway_month = ?
         AND bf.user_fid = ?
         AND wu.pfp_url IS NOT NULL
       ORDER BY bf.mutual_affinity_score DESC, e.created_on DESC
       LIMIT 10`
    )
      .bind(giveawayMonth, fid)
      .all<{ fid: number; username: string | null; pfp_url: string | null }>();
    const rows = (best.results ?? []).filter((row) => row.pfp_url);
    if (rows.length > 0) {
      return rows.map((row) => ({ fid: row.fid, username: row.username ?? String(row.fid), pfpUrl: row.pfp_url ?? "" }));
    }
  }

  const latest = await db.prepare(
    `SELECT wu.fid, wu.username, wu.pfp_url
     FROM million_giveaway_entries e
     JOIN warplets_users wu ON wu.id = e.user_id
     WHERE e.giveaway_month = ?
       AND wu.pfp_url IS NOT NULL
     ORDER BY e.created_on DESC
     LIMIT 10`
  )
    .bind(giveawayMonth)
    .all<{ fid: number; username: string | null; pfp_url: string | null }>();
  return (latest.results ?? []).map((row) => ({ fid: row.fid, username: row.username ?? String(row.fid), pfpUrl: row.pfp_url ?? "" }));
}

async function loadTopReferrers(db: D1Database) {
  const result = await db.prepare(
    `SELECT fid, username, pfp_url, referrals_count
     FROM warplets_users
     WHERE referrals_count > 0
     ORDER BY referrals_count DESC, score DESC, fid ASC
     LIMIT 25`
  ).all<{ fid: number; username: string | null; pfp_url: string | null; referrals_count: number }>();
  return (result.results ?? []).map((row) => ({
    fid: row.fid,
    username: row.username ?? String(row.fid),
    pfpUrl: row.pfp_url ?? "",
    referrals: row.referrals_count,
  }));
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const fid = await resolveFid(context);
  const giveawayMonth = currentGiveawayMonth();
  const actions = await loadActions(context.env.WARPLETS);

  let userId: number | null = null;
  let referralCount = 0;
  let email: string | null = null;
  let hasEntry = false;
  let userEntries = 0;
  let completions = new Map<string, string | null>();
  let previousCompletions = new Set<string>();

  if (fid) {
    const user = await context.env.WARPLETS.prepare(
      "SELECT id, referrals_count FROM warplets_users WHERE fid = ? LIMIT 1"
    )
      .bind(fid)
      .first<{ id: number; referrals_count: number | null }>();
    if (user) {
      userId = user.id;
      referralCount = Math.max(0, Number(user.referrals_count ?? 0));
      const emailRow = await context.env.WARPLETS.prepare(
        `SELECT email
         FROM email_waitlist
         WHERE fid = ?
           AND unsubscribed_at IS NULL
         ORDER BY verified DESC, subscribed_at DESC
         LIMIT 1`
      )
        .bind(fid)
        .first<{ email: string }>();
      email = emailRow?.email ?? null;

      const entry = await context.env.WARPLETS.prepare(
        `SELECT id FROM million_giveaway_entries WHERE user_id = ? AND giveaway_month = ? LIMIT 1`
      )
        .bind(user.id, giveawayMonth)
        .first<{ id: number }>();
      hasEntry = Boolean(entry);

      const completed = await context.env.WARPLETS.prepare(
        `SELECT action_slug, verification
         FROM million_giveaway_action_entries
         WHERE user_id = ? AND giveaway_month = ?`
      )
        .bind(user.id, giveawayMonth)
        .all<ActionCompletionRow>();
      completions = new Map((completed.results ?? []).map((row) => [row.action_slug, row.verification] as const));

      const previous = await context.env.WARPLETS.prepare(
        `SELECT action_slug
         FROM actions_completed
         WHERE user_id = ?
           AND action_slug IN (
             'drop-cast',
             'drop-tweet',
             'drop-follow-fc-10xmeme',
             'drop-follow-fc-10xchris',
             'drop-follow-x-10xmeme',
             'drop-follow-x-10xchris',
             'drop-join-fc-channel',
             'drop-join-telegram'
           )
         UNION
         SELECT action_slug
         FROM million_giveaway_action_entries
         WHERE user_id = ?
           AND giveaway_month <> ?`
      )
        .bind(user.id, user.id, giveawayMonth)
        .all<{ action_slug: string }>();
      const equivalent = new Map([
        ["drop-cast", "million-cast"],
        ["drop-tweet", "million-tweet"],
        ["drop-follow-fc-10xmeme", "million-follow-fc-10xmeme"],
        ["drop-follow-fc-10xchris", "million-follow-fc-10xchris"],
        ["drop-follow-x-10xmeme", "million-follow-x-10xmeme"],
        ["drop-follow-x-10xchris", "million-follow-x-10xchris"],
        ["drop-join-fc-channel", "million-join-fc-channel"],
        ["drop-join-telegram", "million-join-telegram"],
      ]);
      previousCompletions = new Set((previous.results ?? []).map((row) => equivalent.get(row.action_slug) ?? row.action_slug));

      const entryTotal = await context.env.WARPLETS.prepare(
        `SELECT COALESCE(SUM(entries_awarded), 0) AS total
         FROM million_giveaway_action_entries
         WHERE user_id = ? AND giveaway_month = ?`
      )
        .bind(user.id, giveawayMonth)
        .first<{ total: number }>();
      userEntries = Number(entryTotal?.total ?? 0) + Math.min(10, referralCount);
    }
  }

  const totalRow = await context.env.WARPLETS.prepare(
    `SELECT COALESCE(SUM(entries_awarded), 0) AS total
     FROM million_giveaway_action_entries
     WHERE giveaway_month = ?`
  )
    .bind(giveawayMonth)
    .first<{ total: number }>();
  const referralRows = await context.env.WARPLETS.prepare(
    `SELECT COALESCE(SUM(CASE WHEN referrals_count > 10 THEN 10 ELSE referrals_count END), 0) AS total
     FROM warplets_users
     WHERE referrals_count > 0`
  ).first<{ total: number }>();

  const actionSessionToken = fid ? await createActionSessionToken(context.env.ACTION_SESSION_SECRET, fid, 3600) : null;
  const actionItems = actions.map((action) => ({
    id: action.id,
    slug: action.slug,
    name: action.name,
    description: action.description,
    appAction: action.app_action,
    url: action.url,
    verificationMethod: action.verification_method,
    entryValue: Number(action.entry_value ?? 0),
    completed: completions.has(action.slug),
    verification: completions.get(action.slug) ?? null,
    previouslyCompleted: previousCompletions.has(action.slug),
  }));

  return jsonSecure({
    giveawayMonth,
    hasEntry,
    email,
    userEntries,
    totalEntries: Number(totalRow?.total ?? 0) + Number(referralRows?.total ?? 0),
    daysLeft: daysLeftInUtcMonth(),
    referralCount,
    referralBonusEntries: Math.min(10, referralCount),
    entryAvatars: await loadEntryAvatars(context.env.WARPLETS, giveawayMonth, fid, url.searchParams.get("entries") === "1"),
    topReferrers: await loadTopReferrers(context.env.WARPLETS),
    actionSessionToken,
    actions: actionItems,
    userId,
  });
};

export const onRequestPost = onRequestGet;
