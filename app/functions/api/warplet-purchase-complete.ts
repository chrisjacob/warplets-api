interface Env {
  WARPLETS: D1Database;
}
import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../_lib/security.js";

interface RequestBody {
  fid?: unknown;
  transactionId?: unknown;
  transactionError?: unknown;
}

function toPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function toTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function hasWarpletsUsersColumn(db: D1Database, name: string): Promise<boolean> {
  const result = await db
    .prepare("PRAGMA table_info(warplets_users)")
    .all<{ name: unknown }>();
  return (result.results ?? []).some((row) => row.name === name);
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 4 * 1024);
  if (!parsed.ok) return parsed.response;
  const payload = parseObjectPayload<RequestBody>(parsed.value, ["fid", "transactionId", "transactionError"]);
  if (!payload.ok) return payload.response;
  const body = payload.payload;

  const fid = toPositiveInteger(body.fid);
  if (!fid) {
    return jsonSecure({ error: "fid is required" }, { status: 400 });
  }
  const transactionId = toTrimmedString(body.transactionId);
  const transactionError = toTrimmedString(body.transactionError);
  const isFailureUpdate = Boolean(transactionError);

  const userRow = await context.env.WARPLETS.prepare(
    "SELECT id, buy_in_farcaster_wallet_on FROM warplets_users WHERE fid = ? LIMIT 1"
  )
    .bind(fid)
    .first<{ id: number; buy_in_farcaster_wallet_on: string | null }>();

  if (!userRow) {
    return jsonSecure({ error: "Viewer record not found" }, { status: 404 });
  }

  const hasBuyTransactionId = await hasWarpletsUsersColumn(context.env.WARPLETS, "buy_transaction_id");
  const hasTransactionError = await hasWarpletsUsersColumn(context.env.WARPLETS, "transaction_error");
  const now = new Date().toISOString();

  if (isFailureUpdate) {
    if (!hasTransactionError) {
      return jsonSecure({ fid, updated: false });
    }

    const assignments = [
      "transaction_error = ?",
      hasBuyTransactionId && transactionId ? "buy_transaction_id = ?" : null,
      "updated_on = ?",
    ].filter((item): item is string => Boolean(item));
    const values: unknown[] = [transactionError];
    if (hasBuyTransactionId && transactionId) values.push(transactionId);
    values.push(now, userRow.id);

    await context.env.WARPLETS.prepare(
      `UPDATE warplets_users SET ${assignments.join(", ")} WHERE id = ?`
    )
      .bind(...values)
      .run();

    return jsonSecure({
      fid,
      transactionError,
      updated: true,
    });
  }

  if (userRow.buy_in_farcaster_wallet_on && (!transactionId || !hasBuyTransactionId)) {
    return jsonSecure({
      fid,
      buyInFarcasterWalletOn: userRow.buy_in_farcaster_wallet_on,
      updated: false,
    });
  }

  const assignments = [
    userRow.buy_in_farcaster_wallet_on ? null : "buy_in_farcaster_wallet_on = ?",
    hasBuyTransactionId && transactionId ? "buy_transaction_id = ?" : null,
    hasTransactionError ? "transaction_error = NULL" : null,
    "updated_on = ?",
  ].filter((item): item is string => Boolean(item));
  const values: unknown[] = [];
  if (!userRow.buy_in_farcaster_wallet_on) values.push(now);
  if (hasBuyTransactionId && transactionId) values.push(transactionId);
  values.push(now, userRow.id);

  await context.env.WARPLETS.prepare(
    `UPDATE warplets_users SET ${assignments.join(", ")} WHERE id = ?`
  )
    .bind(...values)
    .run();

  return jsonSecure({
    fid,
    buyInFarcasterWalletOn: userRow.buy_in_farcaster_wallet_on ?? now,
    buyTransactionId: transactionId,
    updated: true,
  });
};
