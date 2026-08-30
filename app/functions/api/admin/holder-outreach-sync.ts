import {
  fetchWithTransientRetry,
  HOLDER_OUTREACH_WINDOW_MS,
  parseHolderOutreachFeedPage,
  type HolderOutreachCast,
} from "../../_lib/holderOutreach.js";
import { jsonSecure, requireAdminScope, type SecurityEnv } from "../../_lib/security.js";

interface Env extends SecurityEnv {
  WARPLETS: D1Database;
  NEYNAR_API_KEY?: string;
}

type HolderRow = {
  fid: number;
  token_id: number;
  owned_count: number;
  x_username: string | null;
};

type SyncStateRow = {
  after_fid: number;
  scanned_holders: number;
  total_holders: number;
  active_holders: number;
  truncated_groups: number;
  cycle_started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  updated_at: string;
};

const HOLDERS_PER_SYNC = 200;
const FIDS_PER_FEED = 25;
const MAX_FEED_PAGES = 5;
const FEED_GROUP_CONCURRENCY = 3;
const NEYNAR_REQUEST_INTERVAL_MS = 250;

const CURRENT_HOLDER_CTE = `WITH ranked_wallet_links AS (
  SELECT
    LOWER(TRIM(wallet)) AS wallet,
    fid,
    x_username,
    ROW_NUMBER() OVER (
      PARTITION BY LOWER(TRIM(wallet))
      ORDER BY COALESCE(score, 0) DESC, fid ASC
    ) AS wallet_rank
  FROM wallet_farcaster_links
  WHERE fid > 0
), resolved_tokens AS (
  SELECT
    s.token_id,
    COALESCE(s.owner_fid, l.fid) AS fid,
    l.x_username
  FROM warplet_market_state s
  LEFT JOIN ranked_wallet_links l
    ON l.wallet = LOWER(TRIM(s.owner_wallet))
   AND l.wallet_rank = 1
  WHERE COALESCE(s.owner_fid, l.fid) > 0
), current_holders AS (
  SELECT
    fid,
    MIN(token_id) AS token_id,
    COUNT(*) AS owned_count,
    MAX(x_username) AS x_username
  FROM resolved_tokens
  GROUP BY fid
)`;

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

async function runStatements(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (const group of chunks(statements, 50)) {
    await db.batch(group);
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    () => worker(),
  ));
  return results;
}

function createRequestGate(minimumIntervalMs: number): () => Promise<void> {
  let nextStartAt = 0;
  let queue = Promise.resolve();
  return () => {
    const turn = queue.then(async () => {
      const wait = Math.max(0, nextStartAt - Date.now());
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      nextStartAt = Date.now() + minimumIntervalMs;
    });
    queue = turn.catch(() => undefined);
    return turn;
  };
}

async function fetchRecentCastsForGroup(
  apiKey: string,
  holders: HolderRow[],
  cutoff: string,
  beforeRequest: () => Promise<void>,
): Promise<{ casts: Map<number, HolderOutreachCast>; complete: boolean }> {
  const allowedFids = new Set(holders.map((holder) => Number(holder.fid)));
  const latestByFid = new Map<number, HolderOutreachCast>();
  let cursor: string | null = null;
  let complete = false;

  for (let page = 0; page < MAX_FEED_PAGES; page += 1) {
    const url = new URL("https://api.neynar.com/v2/farcaster/feed/");
    url.searchParams.set("feed_type", "filter");
    url.searchParams.set("filter_type", "fids");
    url.searchParams.set("fids", [...allowedFids].join(","));
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);

    let response: Response;
    try {
      response = await fetchWithTransientRetry(url, {
        headers: {
          accept: "application/json",
          "x-api-key": apiKey,
        },
      }, { beforeAttempt: beforeRequest });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Neynar holder feed request failed after retries: ${detail}`);
    }
    if (!response.ok) {
      throw new Error(`Neynar holder feed failed after retries (${response.status})`);
    }

    const parsed = parseHolderOutreachFeedPage(await response.json(), allowedFids);
    let reachedCutoff = false;
    for (const cast of parsed.casts) {
      if (cast.timestamp < cutoff) {
        reachedCutoff = true;
        continue;
      }
      if (!latestByFid.has(cast.fid)) latestByFid.set(cast.fid, cast);
    }

    cursor = parsed.nextCursor;
    if (!cursor || parsed.casts.length === 0 || reachedCutoff) {
      complete = true;
      break;
    }
  }

  return { casts: latestByFid, complete };
}

async function readSyncState(db: D1Database): Promise<SyncStateRow | null> {
  return db.prepare(
    `SELECT after_fid, scanned_holders, total_holders, active_holders,
            truncated_groups, cycle_started_at, completed_at, last_error, updated_at
     FROM holder_outreach_sync_state WHERE singleton = 1`,
  ).first<SyncStateRow>();
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminScope(context, { scope: "notify:inspect" });
  if (!auth.ok) return auth.response;

  const apiKey = context.env.NEYNAR_API_KEY?.trim();
  if (!apiKey) return jsonSecure({ error: "NEYNAR_API_KEY is not configured" }, { status: 503 });

  const requestUrl = new URL(context.request.url);
  const reset = requestUrl.searchParams.get("reset") === "1";
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - HOLDER_OUTREACH_WINDOW_MS).toISOString();

  try {
    const total = await context.env.WARPLETS.prepare(
      `${CURRENT_HOLDER_CTE} SELECT COUNT(*) AS count FROM current_holders`,
    ).first<{ count: number }>();
    const totalHolders = Number(total?.count ?? 0);

    if (reset) {
      await context.env.WARPLETS.prepare(
        `UPDATE holder_outreach_sync_state
         SET after_fid = 0, scanned_holders = 0, total_holders = ?, active_holders = 0,
             truncated_groups = 0, cycle_started_at = ?, completed_at = NULL,
             last_error = NULL, updated_at = ?
         WHERE singleton = 1`,
      ).bind(totalHolders, now, now).run();
    }

    const state = await readSyncState(context.env.WARPLETS);
    const afterFid = reset ? 0 : Number(state?.after_fid ?? 0);
    const holderResult = await context.env.WARPLETS.prepare(
      `${CURRENT_HOLDER_CTE}
       SELECT fid, token_id, owned_count, x_username
       FROM current_holders
       WHERE fid > ?
       ORDER BY fid ASC
       LIMIT ?`,
    ).bind(afterFid, HOLDERS_PER_SYNC).all<HolderRow>();
    const holders = holderResult.results ?? [];

    if (holders.length === 0) {
      const active = await context.env.WARPLETS.prepare(
        "SELECT COUNT(*) AS count FROM holder_outreach_casts WHERE cast_at >= ?",
      ).bind(cutoff).first<{ count: number }>();
      await context.env.WARPLETS.prepare(
        `UPDATE holder_outreach_sync_state
         SET total_holders = ?, active_holders = ?, completed_at = ?, last_error = NULL, updated_at = ?
         WHERE singleton = 1`,
      ).bind(totalHolders, Number(active?.count ?? 0), now, now).run();
      return jsonSecure({ done: true, state: await readSyncState(context.env.WARPLETS) });
    }

    const feedGroups = chunks(holders, FIDS_PER_FEED);
    const beforeNeynarRequest = createRequestGate(NEYNAR_REQUEST_INTERVAL_MS);
    const groupResults = await mapWithConcurrency(
      feedGroups,
      FEED_GROUP_CONCURRENCY,
      (group) => fetchRecentCastsForGroup(apiKey, group, cutoff, beforeNeynarRequest),
    );
    const statements: D1PreparedStatement[] = [];
    let truncatedGroups = 0;

    feedGroups.forEach((group, groupIndex) => {
      const result = groupResults[groupIndex];
      if (!result.complete) truncatedGroups += 1;
      for (const holder of group) {
        const cast = result.casts.get(Number(holder.fid));
        if (cast) {
          statements.push(context.env.WARPLETS.prepare(
            `INSERT INTO holder_outreach_casts (
               fid, cast_hash, username, display_name, pfp_url, x_username,
               cast_text, cast_at, parent_hash, token_id, owned_count, synced_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(fid) DO UPDATE SET
               cast_hash = excluded.cast_hash,
               username = excluded.username,
               display_name = excluded.display_name,
               pfp_url = excluded.pfp_url,
               x_username = COALESCE(excluded.x_username, holder_outreach_casts.x_username),
               cast_text = excluded.cast_text,
               cast_at = excluded.cast_at,
               parent_hash = excluded.parent_hash,
               token_id = excluded.token_id,
               owned_count = excluded.owned_count,
               synced_at = excluded.synced_at`,
          ).bind(
            holder.fid,
            cast.hash,
            cast.username,
            cast.displayName,
            cast.pfpUrl,
            cast.xUsername ?? holder.x_username,
            cast.text,
            cast.timestamp,
            cast.parentHash,
            holder.token_id,
            holder.owned_count,
            now,
          ));
        } else if (result.complete) {
          statements.push(
            context.env.WARPLETS.prepare("DELETE FROM holder_outreach_casts WHERE fid = ?").bind(holder.fid),
          );
        }
      }
    });
    await runStatements(context.env.WARPLETS, statements);

    const lastFid = Number(holders.at(-1)?.fid ?? afterFid);
    const scannedHolders = Number(reset ? 0 : state?.scanned_holders ?? 0) + holders.length;
    const active = await context.env.WARPLETS.prepare(
      "SELECT COUNT(*) AS count FROM holder_outreach_casts WHERE cast_at >= ?",
    ).bind(cutoff).first<{ count: number }>();
    const done = holders.length < HOLDERS_PER_SYNC || scannedHolders >= totalHolders;
    const completedAt = done ? now : null;
    await context.env.WARPLETS.prepare(
      `UPDATE holder_outreach_sync_state
       SET after_fid = ?, scanned_holders = ?, total_holders = ?, active_holders = ?,
           truncated_groups = truncated_groups + ?, completed_at = ?, last_error = NULL, updated_at = ?
       WHERE singleton = 1`,
    ).bind(
      lastFid,
      scannedHolders,
      totalHolders,
      Number(active?.count ?? 0),
      truncatedGroups,
      completedAt,
      now,
    ).run();

    return jsonSecure({
      done,
      processed: holders.length,
      truncatedGroups,
      state: await readSyncState(context.env.WARPLETS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await context.env.WARPLETS.prepare(
      "UPDATE holder_outreach_sync_state SET last_error = ?, updated_at = ? WHERE singleton = 1",
    ).bind(message.slice(0, 500), now).run().catch(() => undefined);
    console.error("holder_outreach_sync_failed", { message });
    return jsonSecure({ error: message }, { status: 502 });
  }
};
