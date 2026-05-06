interface Env {
  WARPLETS: D1Database;
}

interface RequestBody {
  fid?: unknown;
}

function toPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: RequestBody = {};
  try {
    body = (await context.request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fid = toPositiveInteger(body.fid);
  if (!fid) {
    return Response.json({ error: "fid is required" }, { status: 400 });
  }

  const userRow = await context.env.WARPLETS.prepare(
    "SELECT id, buy_in_farcaster_wallet_on FROM warplets_users WHERE fid = ? LIMIT 1"
  )
    .bind(fid)
    .first<{ id: number; buy_in_farcaster_wallet_on: string | null }>();

  if (!userRow) {
    return Response.json({ error: "Viewer record not found" }, { status: 404 });
  }

  if (userRow.buy_in_farcaster_wallet_on) {
    return Response.json({
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

  return Response.json({
    fid,
    buyInFarcasterWalletOn: now,
    updated: true,
  });
};
