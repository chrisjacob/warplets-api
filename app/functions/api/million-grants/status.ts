interface Env {
  WARPLETS: D1Database;
  ACTION_SESSION_SECRET?: string;
  ALLOW_INSECURE_ACTION_FID_FALLBACK?: string;
  RECAPTCHA_SITE_KEY?: string;
}
import { createActionSessionToken, jsonSecure, verifyActionSessionToken } from "../../_lib/security.js";

type ConfigMap = Record<string, string>;
type AvatarRow = { fid: number; username: string | null; pfp_url: string | null };
type MetadataAvatarRow = {
  fid_value: number | null;
  warplet_username_farcaster: string | null;
  token_id: number;
  webp_url: string | null;
  image_url: string | null;
};

function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function asPositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isLocalDevHost(hostname: string): boolean {
  return (
    hostname.includes("-local.") ||
    hostname.includes("-dev.") ||
    hostname.endsWith(".pages.dev") ||
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1"
  );
}

function isMillionLocalHost(hostname: string): boolean {
  return hostname === "million-local.10x.meme";
}

async function resolveFid(context: EventContext<Env, string, unknown>): Promise<number | null> {
  const url = new URL(context.request.url);
  const token = url.searchParams.get("sessionToken")?.trim() || null;
  const session = await verifyActionSessionToken(context.env.ACTION_SESSION_SECRET, token);
  if (session.valid) return session.fid;
  if (!isLocalDevHost(url.hostname) && context.env.ALLOW_INSECURE_ACTION_FID_FALLBACK !== "1") return null;
  return asPositiveInt(url.searchParams.get("fid"));
}

async function loadConfig(db: D1Database): Promise<ConfigMap> {
  try {
    const rows = await db.prepare("SELECT key, value FROM million_app_config").all<{ key: string; value: string }>();
    return Object.fromEntries((rows.results ?? []).map((row) => [row.key, row.value]));
  } catch {
    return {};
  }
}

function normalizeAvatars(rows: AvatarRow[]) {
  return rows
    .filter((row) => typeof row.fid === "number" && typeof row.pfp_url === "string" && row.pfp_url.trim().length > 0)
    .map((row) => ({
      fid: row.fid,
      username: row.username ?? String(row.fid),
      pfpUrl: row.pfp_url ?? "",
    }))
    .slice(0, 10);
}

function normalizeMetadataAvatars(rows: MetadataAvatarRow[]) {
  return rows
    .filter((row) => typeof row.fid_value === "number")
    .map((row) => ({
      fid: row.fid_value as number,
      username: row.warplet_username_farcaster?.trim() || `Warplet #${row.token_id}`,
      pfpUrl: row.webp_url?.trim() || row.image_url?.trim() || `https://warplets.10x.meme/${row.token_id}.webp`,
    }))
    .filter((row) => row.pfpUrl.length > 0)
    .slice(0, 10);
}

async function fillWithLocalMetadataAvatars(db: D1Database, applicants: ReturnType<typeof normalizeAvatars>, seen: Set<number>): Promise<void> {
  if (applicants.length >= 10) return;

  const latest = await db.prepare(
    `SELECT fid_value, warplet_username_farcaster, token_id, webp_url, image_url
     FROM warplets_metadata
     WHERE fid_value IS NOT NULL
     ORDER BY token_id DESC
     LIMIT 25`
  ).all<MetadataAvatarRow>();

  for (const avatar of normalizeMetadataAvatars(latest.results ?? [])) {
    if (applicants.length >= 10) break;
    if (seen.has(avatar.fid)) continue;
    applicants.push(avatar);
    seen.add(avatar.fid);
  }
}

async function loadApplicants(db: D1Database, grantMonth: string, viewerFid: number | null, options: { localRecentPurchaserFill?: boolean } = {}) {
  const applicants: ReturnType<typeof normalizeAvatars> = [];
  const seen = new Set<number>();

  try {
    if (viewerFid) {
      const friends = await db.prepare(
        `SELECT wu.fid, wu.username, wu.pfp_url
         FROM million_grant_applications mga
         JOIN warplets_users wu ON wu.id = mga.user_id
         JOIN warplets_user_best_friends bf ON bf.best_friend_fid = wu.fid
         WHERE mga.grant_month = ?
           AND mga.status = 'accepted'
           AND bf.user_fid = ?
           AND wu.pfp_url IS NOT NULL
           AND TRIM(wu.pfp_url) <> ''
         ORDER BY bf.mutual_affinity_score DESC, mga.created_on DESC
         LIMIT 10`
      )
        .bind(grantMonth, viewerFid)
        .all<AvatarRow>();

      for (const avatar of normalizeAvatars(friends.results ?? [])) {
        if (seen.has(avatar.fid)) continue;
        applicants.push(avatar);
        seen.add(avatar.fid);
      }
    }

    if (applicants.length < 10) {
      const latest = await db.prepare(
        `SELECT wu.fid, wu.username, wu.pfp_url
         FROM million_grant_applications mga
         JOIN warplets_users wu ON wu.id = mga.user_id
         WHERE mga.grant_month = ?
           AND mga.status = 'accepted'
           AND wu.pfp_url IS NOT NULL
           AND TRIM(wu.pfp_url) <> ''
         ORDER BY mga.created_on DESC
         LIMIT 25`
      )
        .bind(grantMonth)
        .all<AvatarRow>();

      for (const avatar of normalizeAvatars(latest.results ?? [])) {
        if (applicants.length >= 10) break;
        if (seen.has(avatar.fid)) continue;
        applicants.push(avatar);
        seen.add(avatar.fid);
      }
    }

    if (options.localRecentPurchaserFill) {
      await fillWithLocalMetadataAvatars(db, applicants, seen);
    }
  } catch {
    return [];
  }

  return applicants;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const grantMonth = currentMonth();
  const fid = await resolveFid(context);
  const config = await loadConfig(context.env.WARPLETS);
  let application = null as null | {
    id: number;
    status: string;
    fullName: string;
    email: string;
    buildAnswer: string;
    xPostUrl: string | null;
    farcasterPostUrl: string | null;
    emailVerified: boolean;
  };

  if (fid) {
    const row = await context.env.WARPLETS.prepare(
      `SELECT mga.id, mga.status, mga.full_name, mga.email, mga.build_answer, mga.x_post_url, mga.farcaster_post_url,
              COALESCE(ew.verified, 0) AS email_verified
       FROM million_grant_applications mga
       LEFT JOIN email_waitlist ew ON LOWER(ew.email) = LOWER(mga.email)
       WHERE mga.user_fid = ? AND mga.grant_month = ?
       ORDER BY mga.updated_on DESC
       LIMIT 1`
    )
      .bind(fid, grantMonth)
      .first<{
        id: number;
        status: string;
        full_name: string;
        email: string;
        build_answer: string;
        x_post_url: string | null;
        farcaster_post_url: string | null;
        email_verified: number;
      }>();

    if (row) {
      application = {
        id: row.id,
        status: row.status,
        fullName: row.full_name,
        email: row.email,
        buildAnswer: row.build_answer,
        xPostUrl: row.x_post_url,
        farcasterPostUrl: row.farcaster_post_url,
        emailVerified: row.email_verified === 1,
      };
    }
  }

  const actionSessionToken = fid ? await createActionSessionToken(context.env.ACTION_SESSION_SECRET, fid, 3600) : null;
  return jsonSecure({
    grantMonth,
    application,
    applicants: await loadApplicants(context.env.WARPLETS, grantMonth, fid, {
      localRecentPurchaserFill: isMillionLocalHost(url.hostname),
    }),
    actionSessionToken,
    recaptchaSiteKey: context.env.RECAPTCHA_SITE_KEY?.trim() || "",
    config: {
      xQuoteUrl: config.x_quote_url ?? "",
      farcasterQuoteUrl: config.farcaster_quote_url ?? "",
    },
  });
};

export const onRequestPost = onRequestGet;
