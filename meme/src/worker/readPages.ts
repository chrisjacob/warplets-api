import { principal } from "./auth";
import { json, requireThat, rows, type Database } from "./db";
import { ownEntitlements } from "./settlement";
import type { StoredRound } from "./rounds";

type Cursor = {
  v: 1;
  kind: "history" | "rewards";
  owner: number;
  through: number;
  at: number;
  id: string;
};
const encode = (value: Cursor) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

function parameters(
  request: Request,
  kind: Cursor["kind"],
  owner: number,
  now: number,
) {
  const params = new URL(request.url).searchParams;
  requireThat(
    [...params.keys()].every(
      (k) => ["limit", "cursor"].includes(k) && params.getAll(k).length === 1,
    ),
    400,
    "Invalid page parameters",
  );
  const rawLimit = params.get("limit") ?? "20";
  requireThat(
    /^[1-9]\d?$/.test(rawLimit) && Number(rawLimit) <= 20,
    400,
    "Page limit must be 1–20",
  );
  const raw = params.get("cursor");
  let cursor: Cursor | null = null;
  if (raw !== null) {
    requireThat(
      raw.length > 0 && raw.length <= 2048 && /^[A-Za-z0-9_-]+$/.test(raw),
      400,
      "Invalid page cursor",
    );
    let parsed: unknown;
    try {
      const bytes = Uint8Array.from(
        atob(
          raw.replaceAll("-", "+").replaceAll("_", "/") +
            "=".repeat((4 - (raw.length % 4)) % 4),
        ),
        (c) => c.charCodeAt(0),
      );
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          bytes,
        ),
      );
    } catch {
      requireThat(false, 400, "Invalid page cursor");
    }
    requireThat(
      parsed && typeof parsed === "object" && !Array.isArray(parsed),
      400,
      "Invalid page cursor",
    );
    const p = parsed as Record<string, unknown>;
    requireThat(
      Object.keys(p).sort().join(",") === "at,id,kind,owner,through,v" &&
        p.v === 1 &&
        p.kind === kind &&
        p.owner === owner &&
        Number.isSafeInteger(p.through) &&
        Number(p.through) >= 0 &&
        Number(p.through) <= now &&
        Number.isSafeInteger(p.at) &&
        Number(p.at) >= 0 &&
        Number(p.at) <= Number(p.through) &&
        typeof p.id === "string" &&
        p.id.length > 0 &&
        p.id.length <= 256,
      400,
      "Invalid page cursor",
    );
    cursor = {
      v: 1,
      kind,
      owner,
      through: Number(p.through),
      at: Number(p.at),
      id: p.id as string,
    };
  }
  return { limit: Number(rawLimit), cursor, through: cursor?.through ?? now };
}
function page<T>(
  items: T[],
  limit: number,
  context: Omit<Cursor, "v" | "at" | "id">,
  key: (item: T) => { at: number; id: string },
) {
  const visible = items.slice(0, limit);
  return {
    items: visible,
    nextCursor:
      items.length > limit
        ? encode({ v: 1, ...context, ...key(visible[visible.length - 1]) })
        : null,
    throughAt: context.through,
  };
}
export async function historyPage(db: Database, request: Request) {
  const now = Date.now(),
    { limit, cursor, through } = parameters(request, "history", 0, now);
  const found = await rows<
    Pick<
      StoredRound,
      | "id"
      | "opens_at"
      | "closes_at"
      | "state"
      | "selected_candidate"
      | "outcome_reason"
    > & { selected_name: string | null }
  >(
    db,
    `SELECT r.id,r.opens_at,r.closes_at,r.state,r.selected_candidate,r.outcome_reason,c.name selected_name FROM meme_rounds r LEFT JOIN meme_candidates c ON c.round_id=r.id AND c.id=r.selected_candidate WHERE r.state IN('closed','selected','skipped') AND r.closes_at<=? ${cursor ? "AND (r.closes_at,r.id)<(?,?)" : ""} ORDER BY r.closes_at DESC,r.id DESC LIMIT ?`,
    through,
    ...(cursor ? [cursor.at, cursor.id] : []),
    limit + 1,
  );
  return {
    ...page(found, limit, { kind: "history", owner: 0, through }, (r) => ({
      at: r.closes_at,
      id: r.id,
    })),
    asOf: now,
  };
}
export async function rewardsPage(db: Database, request: Request) {
  const identity = await principal(db, request),
    now = Date.now();
  const { limit, cursor, through } = parameters(
    request,
    "rewards",
    identity.fid,
    now,
  );
  const found = await rows<{ id: string; launchedAt: number }>(
    db,
    `SELECT i.campaign_id id,i.launched_at launchedAt FROM meme_reward_campaign_index i WHERE i.fid=? AND i.launched_at<=? ${cursor ? "AND (i.launched_at,i.campaign_id)<(?,?)" : ""} AND EXISTS(SELECT 1 FROM meme_allocations a JOIN meme_entitlements e ON e.allocation_id=a.id AND e.fid=i.fid JOIN meme_settlements s ON s.round_id=a.round_id WHERE a.campaign_id=i.campaign_id AND s.state='finalized' AND s.finalized_at<=?) ORDER BY i.launched_at DESC,i.campaign_id DESC LIMIT ?`,
    identity.fid,
    through,
    ...(cursor ? [cursor.at, cursor.id] : []),
    through,
    limit + 1,
  );
  const result = page(
    found,
    limit,
    { kind: "rewards", owner: identity.fid, through },
    (c) => ({ at: c.launchedAt, id: c.id }),
  );
  const rewards = result.items.length
    ? await ownEntitlements(db, identity.fid, {
        campaignIds: result.items.map((c) => c.id),
        throughAt: through,
      })
    : [];
  return {
    ...result,
    items: result.items.map((c) => ({
      ...c,
      rewards: rewards.filter((r) => r.edition_id === c.id),
    })),
    viewerFid: identity.fid,
    asOf: now,
    claimable: false,
  };
}
export async function readPagesRequest(
  db: Database,
  request: Request,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!["/api/meme/history", "/api/meme/rewards"].includes(path)) return null;
  requireThat(request.method === "GET", 405, "Method not allowed");
  return json(
    path.endsWith("history")
      ? await historyPage(db, request)
      : await rewardsPage(db, request),
  );
}
