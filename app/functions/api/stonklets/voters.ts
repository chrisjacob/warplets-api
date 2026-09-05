import { jsonSecure } from "../../_lib/security.js";
import { STONKLETS_BY_ID } from "../../../shared/stonkletsCatalog.js";
import { isStonkletsVotesPreview, mockVoteCount, mockWalletOnly, type StonkletVoter } from "../../../shared/stonkletsVotes.js";

interface Env { WARPLETS: D1Database }
interface Row { identity_wallet: string; favourited_at: string; username: string | null; image: string | null }

// Resolve one profile per identity, so wallets linked to several FIDs never multiply votes.
export const VOTERS_SQL = `WITH voters AS (
 SELECT f.identity_wallet, f.favourited_at,
   COALESCE(NULLIF(u.username, ''), NULLIF(l.username, '')) AS username,
   COALESCE(NULLIF(u.pfp_url, ''), NULLIF(l.pfp_url, '')) AS image
 FROM stonklet_asset_favourites f
 LEFT JOIN wallet_farcaster_links l ON l.wallet = f.identity_wallet AND l.fid = (
   SELECT fid FROM wallet_farcaster_links WHERE wallet = f.identity_wallet ORDER BY score DESC, fid ASC LIMIT 1
 )
 LEFT JOIN warplets_users u ON u.fid = COALESCE(l.fid, (
   SELECT fid FROM warplets_users WHERE lower(trim(primary_eth_address)) = f.identity_wallet ORDER BY fid LIMIT 1
 ))
 WHERE f.pair_id = ? AND f.asset = 'stonklet' AND f.active = 1
)
SELECT * FROM voters WHERE (? = 0 OR image LIKE 'https://%' OR image LIKE 'http://%')
 AND (? IS NULL OR favourited_at < ? OR (favourited_at = ? AND identity_wallet > ?))
ORDER BY favourited_at DESC, identity_wallet ASC LIMIT ?`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!STONKLETS_BY_ID.has(id)) return jsonSecure({ error: "unknown Stonklet" }, { status: 400 });
  const stack = url.searchParams.get("stack") === "1";
  const size = stack ? 10 : 20;
  const rawCursor = url.searchParams.get("cursor");
  const preview = isStonkletsVotesPreview(url);
  let cursor: [string, string] | null = null;
  let offset = 0;
  if (rawCursor) {
    try {
      if (rawCursor.length > 512) throw new Error();
      if (preview) {
        if (!/^\d{1,5}$/.test(rawCursor)) throw new Error();
        offset = Number(rawCursor);
      } else {
        const value: unknown = JSON.parse(atob(rawCursor));
        if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || !Number.isFinite(Date.parse(value[0])) || typeof value[1] !== "string" || !/^0x[0-9a-f]{40}$/.test(value[1])) throw new Error();
        cursor = value as [string, string];
      }
    } catch { return jsonSecure({ error: "invalid cursor" }, { status: 400 }); }
  }
  if (preview) {
    const self = url.searchParams.get("self") === "1";
    const total = mockVoteCount(id) + (self ? 1 : 0);
    // Real cached Farcaster photos, fictional votes: never write preview data to D1.
    const profiles = await env.WARPLETS.prepare("SELECT username, pfp_url AS image FROM warplets_users WHERE pfp_url LIKE 'https://%' ORDER BY fid LIMIT 60").all<{ username: string | null; image: string }>();
    const people = profiles.results ?? [];
    const voters: StonkletVoter[] = [];
    let index = offset;
    while (index < total && voters.length < size) {
      const n = index++;
      const ownVote = self && n === 0;
      const position = n - (self ? 1 : 0);
      const profile = !ownVote && !mockWalletOnly(id) && position % 4 !== 3 && people.length ? people[position % people.length] : null;
      if (stack && !profile) continue;
      voters.push({ wallet: ownVote ? "0xffffffffffffffffffffffffffffffffffffffff" : `0x${(position + 1).toString(16).padStart(40, "0")}`, username: profile?.username ?? null, image: profile?.image ?? null, votedAt: new Date(Date.UTC(2026, 8, 1) - position * 60_000).toISOString() });
    }
    return jsonSecure({ total, voters, nextCursor: !stack && index < total ? String(index) : null });
  }
  const [count, page] = await Promise.all([
    env.WARPLETS.prepare("SELECT COUNT(*) AS total FROM stonklet_asset_favourites WHERE pair_id = ? AND asset = 'stonklet' AND active = 1").bind(id).first<{ total: number }>(),
    env.WARPLETS.prepare(VOTERS_SQL).bind(id, stack ? 1 : 0, cursor?.[0] ?? null, cursor?.[0] ?? null, cursor?.[0] ?? null, cursor?.[1] ?? null, size + 1).all<Row>(),
  ]);
  const rows = page.results ?? [];
  const selected = rows.slice(0, size);
  const last = selected.at(-1);
  return jsonSecure({ total: Number(count?.total ?? 0), voters: selected.map((row) => ({ wallet: row.identity_wallet, username: row.username, image: row.image && /^https?:\/\//i.test(row.image) ? row.image : null, votedAt: row.favourited_at })), nextCursor: !stack && rows.length > size && last ? btoa(JSON.stringify([last.favourited_at, last.identity_wallet])) : null });
};
