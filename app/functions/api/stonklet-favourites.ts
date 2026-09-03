import { getAppSession } from "../_lib/appAuth.js";
import { requireSameOrigin } from "../_lib/authValidation.js";
import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../_lib/security.js";
import { resolveSessionFavouriteWallet } from "./warplet-favourites.js";
import { STONKLETS_BY_ID } from "../../shared/stonkletsCatalog.js";

interface Env { WARPLETS: D1Database; APP_SESSION_SECRET?: string }
type FavouriteAsset = "stock" | "stonklet";
interface Payload { stonkletId?: unknown; asset?: unknown; favourited?: unknown; notifyOnLaunch?: unknown }

async function personalState(db: D1Database, wallet: string) {
  const result = await db.prepare(
    "SELECT pair_id, asset, notify_on_launch FROM stonklet_asset_favourites WHERE identity_wallet = ? AND active = 1 ORDER BY pair_id, asset",
  ).bind(wallet).all<{ pair_id: string; asset: FavouriteAsset; notify_on_launch: number }>();
  const rows = result.results ?? [];
  const stonkletRows = rows.filter((row) => row.asset === "stonklet");
  return {
    ids: stonkletRows.map((row) => row.pair_id),
    stockIds: rows.filter((row) => row.asset === "stock").map((row) => row.pair_id),
    alerts: Object.fromEntries(stonkletRows.map((row) => [row.pair_id, row.notify_on_launch === 1])),
  };
}

async function counts(db: D1Database) {
  const result = await db.prepare(
    `SELECT pair_id, asset,
            SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS total,
            SUM(CASE WHEN active = 1 AND julianday(favourited_at) >= julianday('now', '-7 days') THEN 1 ELSE 0 END) AS momentum
     FROM stonklet_asset_favourites GROUP BY pair_id, asset`,
  ).all<{ pair_id: string; asset: FavouriteAsset; total: number; momentum: number }>();
  const rows = result.results ?? [];
  const values = (asset: FavouriteAsset) => Object.fromEntries(rows.filter((row) => row.asset === asset).map((row) => [row.pair_id, { total: Number(row.total) || 0, momentum7d: Number(row.momentum) || 0 }]));
  return { counts: values("stonklet"), stockCounts: values("stock") };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getAppSession(request, env);
  const wallet = await resolveSessionFavouriteWallet(env.WARPLETS, session);
  const aggregateCounts = await counts(env.WARPLETS);
  if (!wallet) return jsonSecure({ authenticated: false, ids: [], stockIds: [], alerts: {}, ...aggregateCounts });
  return jsonSecure({ authenticated: true, wallet, ...await personalState(env.WARPLETS, wallet), ...aggregateCounts });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const parsed = await readJsonBodyWithLimit<unknown>(request, 8 * 1024);
  if (!parsed.ok) return parsed.response;
  const body = parseObjectPayload<Payload>(parsed.value, ["stonkletId", "asset", "favourited", "notifyOnLaunch"]);
  if (!body.ok) return body.response;
  const id = typeof body.payload.stonkletId === "string" ? body.payload.stonkletId.trim() : "";
  if (!STONKLETS_BY_ID.has(id)) return jsonSecure({ error: "unknown Stonklet" }, { status: 400 });
  const asset = body.payload.asset == null ? "stonklet" : body.payload.asset;
  if (asset !== "stock" && asset !== "stonklet") return jsonSecure({ error: "asset must be stock or stonklet" }, { status: 400 });
  if (typeof body.payload.favourited !== "boolean") return jsonSecure({ error: "favourited must be boolean" }, { status: 400 });
  const session = await getAppSession(request, env);
  const wallet = await resolveSessionFavouriteWallet(env.WARPLETS, session);
  if (!wallet) return jsonSecure({ error: "a verified Farcaster identity or wallet is required" }, { status: 401 });
  const favourited = body.payload.favourited;
  const notify = asset === "stonklet" && favourited && body.payload.notifyOnLaunch !== false;
  const now = new Date().toISOString();
  await env.WARPLETS.prepare(
    `INSERT INTO stonklet_asset_favourites
      (identity_wallet, pair_id, asset, active, notify_on_launch, first_favourited_at, favourited_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(identity_wallet, pair_id, asset) DO UPDATE SET
       active = excluded.active,
       notify_on_launch = excluded.notify_on_launch,
       favourited_at = CASE WHEN excluded.active = 1 AND stonklet_asset_favourites.active = 0 THEN excluded.favourited_at ELSE stonklet_asset_favourites.favourited_at END,
       updated_at = excluded.updated_at`,
  ).bind(wallet, id, asset, favourited ? 1 : 0, notify ? 1 : 0, now, now, now).run();
  return jsonSecure({ authenticated: true, wallet, ...await personalState(env.WARPLETS, wallet), ...await counts(env.WARPLETS) });
};
