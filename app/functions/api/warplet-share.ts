interface Env {
  WARPLETS: D1Database;
}
import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../_lib/security.js";

interface RequestBody {
  fid?: unknown;
}

function toPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 4 * 1024);
  if (!parsed.ok) return parsed.response;
  const payload = parseObjectPayload<RequestBody>(parsed.value, ["fid"]);
  if (!payload.ok) return payload.response;
  const body = payload.payload;

  const fid = toPositiveInteger(body.fid);
  if (!fid) {
    return jsonSecure({ error: "fid is required" }, { status: 400 });
  }

  const userRow = await context.env.WARPLETS.prepare(
    "SELECT id, shared_on FROM warplets_users WHERE fid = ? LIMIT 1"
  )
    .bind(fid)
    .first<{ id: number; shared_on: string | null }>();

  if (!userRow) {
    return jsonSecure({ error: "Viewer record not found" }, { status: 404 });
  }

  if (userRow.shared_on) {
    return jsonSecure({
      fid,
      sharedOn: userRow.shared_on,
      updated: false,
    });
  }

  const now = new Date().toISOString();
  await context.env.WARPLETS.prepare(
    "UPDATE warplets_users SET shared_on = ?, updated_on = ? WHERE id = ?"
  )
    .bind(now, now, userRow.id)
    .run();

  return jsonSecure({
    fid,
    sharedOn: now,
    updated: true,
  });
};
