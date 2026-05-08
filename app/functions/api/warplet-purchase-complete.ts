interface Env {
  WARPLETS: D1Database;
}
import { jsonSecure, readJsonBodyWithLimit } from "../_lib/security.js";

interface RequestBody {
  fid?: unknown;
}

function toPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 4 * 1024);
  if (!parsed.ok) return parsed.response;
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return jsonSecure({ error: "Invalid JSON payload" }, { status: 400 });
  }
  const payload = parsed.value as Record<string, unknown>;
  if (!Object.keys(payload).every((key) => key === "fid")) {
    return jsonSecure({ error: "Unexpected fields in payload" }, { status: 400 });
  }
  const body = payload as RequestBody;

  const fid = toPositiveInteger(body.fid);
  if (!fid) {
    return jsonSecure({ error: "fid is required" }, { status: 400 });
  }

  const userRow = await context.env.WARPLETS.prepare(
    "SELECT id, buy_in_farcaster_wallet_on FROM warplets_users WHERE fid = ? LIMIT 1"
  )
    .bind(fid)
    .first<{ id: number; buy_in_farcaster_wallet_on: string | null }>();

  if (!userRow) {
    return jsonSecure({ error: "Viewer record not found" }, { status: 404 });
  }

  if (userRow.buy_in_farcaster_wallet_on) {
    return jsonSecure({
      fid,
      buyInFarcasterWalletOn: userRow.buy_in_farcaster_wallet_on,
      updated: false,
    });
  }

  const now = new Date().toISOString();
  await context.env.WARPLETS.prepare(
    "UPDATE warplets_users SET buy_in_farcaster_wallet_on = ?, updated_on = ? WHERE id = ?"
  )
    .bind(now, now, userRow.id)
    .run();

  return jsonSecure({
    fid,
    buyInFarcasterWalletOn: now,
    updated: true,
  });
};
