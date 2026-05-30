interface Env {
  WARPLETS: D1Database;
  ACTION_SESSION_SECRET?: string;
  ALLOW_INSECURE_ACTION_FID_FALLBACK?: string;
}
import { jsonSecure, readJsonBodyWithLimit, verifyActionSessionToken } from "../_lib/security.js";

type WatcherRow = {
  fid: number;
  username: string | null;
  pfp_url: string | null;
};

type MetadataAvatarRow = {
  fid_value: number | null;
  warplet_username_farcaster: string | null;
  token_id: number;
  webp_url: string | null;
  image_url: string | null;
};

type Watcher = {
  fid: number;
  username: string;
  pfpUrl: string;
};

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

async function resolveFid(
  env: Env,
  requestUrl: URL,
  fallbackFid: number | null,
  sessionToken: string | null
): Promise<number | null> {
  const session = await verifyActionSessionToken(env.ACTION_SESSION_SECRET, sessionToken);
  if (session.valid) return session.fid;

  if (!isLocalDevHost(requestUrl.hostname) && env.ALLOW_INSECURE_ACTION_FID_FALLBACK !== "1") return null;
  return fallbackFid;
}

function normalizeWatchers(rows: WatcherRow[]): Watcher[] {
  return rows
    .filter((row) => typeof row.fid === "number" && typeof row.pfp_url === "string" && row.pfp_url.trim().length > 0)
    .map((row) => ({
      fid: row.fid,
      username: row.username ?? String(row.fid),
      pfpUrl: row.pfp_url ?? "",
    }))
    .slice(0, 10);
}

function normalizeMetadataAvatars(rows: MetadataAvatarRow[]): Watcher[] {
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

async function fillWithLocalMetadataAvatars(db: D1Database, watchers: Watcher[], seen: Set<number>): Promise<void> {
  if (watchers.length >= 10) return;

  const latest = await db.prepare(
    `SELECT fid_value, warplet_username_farcaster, token_id, webp_url, image_url
     FROM warplets_metadata
     WHERE fid_value IS NOT NULL
     ORDER BY token_id DESC
     LIMIT 25`
  ).all<MetadataAvatarRow>();

  for (const watcher of normalizeMetadataAvatars(latest.results ?? [])) {
    if (watchers.length >= 10) break;
    if (seen.has(watcher.fid)) continue;
    watchers.push(watcher);
    seen.add(watcher.fid);
  }
}

async function loadWatchers(db: D1Database, viewerFid: number | null, options: { localRecentPurchaserFill?: boolean } = {}): Promise<Watcher[]> {
  const watchers: Watcher[] = [];
  const seen = new Set<number>();

  try {
    if (viewerFid) {
      const friends = await db.prepare(
        `SELECT wu.fid, wu.username, wu.pfp_url
         FROM million_watchers mw
         JOIN warplets_users wu ON wu.id = mw.user_id
         JOIN warplets_user_best_friends bf ON bf.best_friend_fid = wu.fid
         WHERE bf.user_fid = ?
           AND wu.pfp_url IS NOT NULL
           AND TRIM(wu.pfp_url) <> ''
         ORDER BY bf.mutual_affinity_score DESC, mw.watched_on DESC
         LIMIT 10`
      )
        .bind(viewerFid)
        .all<WatcherRow>();

      for (const watcher of normalizeWatchers(friends.results ?? [])) {
        if (seen.has(watcher.fid)) continue;
        watchers.push(watcher);
        seen.add(watcher.fid);
      }
    }

    if (watchers.length < 10) {
      const latest = await db.prepare(
        `SELECT wu.fid, wu.username, wu.pfp_url
         FROM million_watchers mw
         JOIN warplets_users wu ON wu.id = mw.user_id
         WHERE wu.pfp_url IS NOT NULL
           AND TRIM(wu.pfp_url) <> ''
         ORDER BY mw.watched_on DESC
         LIMIT 25`
      ).all<WatcherRow>();

      for (const watcher of normalizeWatchers(latest.results ?? [])) {
        if (watchers.length >= 10) break;
        if (seen.has(watcher.fid)) continue;
        watchers.push(watcher);
        seen.add(watcher.fid);
      }
    }

    if (options.localRecentPurchaserFill) {
      await fillWithLocalMetadataAvatars(db, watchers, seen);
    }
  } catch {
    return [];
  }

  return watchers;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const fallbackFid = asPositiveInt(url.searchParams.get("fid"));
  const sessionToken = url.searchParams.get("sessionToken")?.trim() || null;
  const viewerFid = await resolveFid(context.env, url, fallbackFid, sessionToken);
  return jsonSecure({
    watchers: await loadWatchers(context.env.WARPLETS, viewerFid, {
      localRecentPurchaserFill: isMillionLocalHost(url.hostname),
    }),
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 2048);
  if (!parsed.ok) return parsed.response;

  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return jsonSecure({ error: "Invalid JSON payload" }, { status: 400 });
  }
  const rawBody = parsed.value as Record<string, unknown>;
  const hasUnexpectedKeys = Object.keys(rawBody).some((key) => !["fid", "sessionToken"].includes(key));
  if (hasUnexpectedKeys) {
    return jsonSecure({ error: "Unexpected fields in payload" }, { status: 400 });
  }

  const body = rawBody as { fid?: unknown; sessionToken?: unknown };
  const fallbackFid = typeof body.fid === "number" && Number.isInteger(body.fid) && body.fid > 0 ? body.fid : null;
  const sessionToken = typeof body.sessionToken === "string" ? body.sessionToken.trim() || null : null;
  const fid = await resolveFid(context.env, url, fallbackFid, sessionToken);

  if (!fid) {
    return jsonSecure({
      tracked: false,
      watchers: await loadWatchers(context.env.WARPLETS, null, {
        localRecentPurchaserFill: isMillionLocalHost(url.hostname),
      }),
    });
  }

  const user = await context.env.WARPLETS.prepare(
    "SELECT id FROM warplets_users WHERE fid = ? LIMIT 1"
  )
    .bind(fid)
    .first<{ id: number }>();

  if (!user) {
    return jsonSecure({
      tracked: false,
      watchers: await loadWatchers(context.env.WARPLETS, fid, {
        localRecentPurchaserFill: isMillionLocalHost(url.hostname),
      }),
    });
  }

  try {
    const now = new Date().toISOString();
    await context.env.WARPLETS.prepare(
      `INSERT INTO million_watchers (user_id, user_fid, watched_on, updated_on)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         watched_on = excluded.watched_on,
         updated_on = excluded.updated_on`
    )
      .bind(user.id, fid, now, now)
      .run();
  } catch {
    return jsonSecure({
      tracked: false,
      watchers: await loadWatchers(context.env.WARPLETS, fid, {
        localRecentPurchaserFill: isMillionLocalHost(url.hostname),
      }),
    });
  }

  return jsonSecure({
    tracked: true,
    watchers: await loadWatchers(context.env.WARPLETS, fid, {
      localRecentPurchaserFill: isMillionLocalHost(url.hostname),
    }),
  });
};
