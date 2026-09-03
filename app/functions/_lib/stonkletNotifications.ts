import { STONKLETS_BY_ID } from "../../shared/stonkletsCatalog.js";

export interface StonkletLaunchAudienceMember {
  identityWallet: string;
  farcasterFid: number | null;
}

/**
 * Atomically reserves the opted-in audience for a Stonklet launch. The
 * delivery table makes retries idempotent; the caller may enqueue the returned
 * identities into the shared multi-channel dispatcher once a launch is live.
 */
export async function reserveStonkletLaunchAudience(db: D1Database, stonkletId: string): Promise<StonkletLaunchAudienceMember[]> {
  if (!STONKLETS_BY_ID.has(stonkletId)) throw new Error("Unknown Stonklet ID");
  const now = new Date().toISOString();
  const result = await db.prepare(
    `SELECT f.identity_wallet,
            COALESCE(u.fid, l.fid) AS farcaster_fid
       FROM stonklet_asset_favourites f
       LEFT JOIN warplets_users u ON lower(trim(u.primary_eth_address)) = f.identity_wallet
       LEFT JOIN wallet_farcaster_links l ON lower(l.wallet) = f.identity_wallet
      WHERE f.pair_id = ? AND f.asset = 'stonklet' AND f.active = 1 AND f.notify_on_launch = 1
      GROUP BY f.identity_wallet`,
  ).bind(stonkletId).all<{ identity_wallet: string; farcaster_fid: number | null }>();
  const reserved: StonkletLaunchAudienceMember[] = [];
  for (const row of result.results ?? []) {
    const inserted = await db.prepare(
      `INSERT OR IGNORE INTO stonklet_launch_deliveries (stonklet_id, identity_wallet, queued_at)
       VALUES (?, ?, ?) RETURNING identity_wallet`,
    ).bind(stonkletId, row.identity_wallet, now).first<{ identity_wallet: string }>();
    if (inserted) reserved.push({ identityWallet: inserted.identity_wallet, farcasterFid: row.farcaster_fid == null ? null : Number(row.farcaster_fid) });
  }
  return reserved;
}
