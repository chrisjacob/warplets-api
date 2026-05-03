/**
 * POST /api/warplet-status
 *
 * Upserts the viewer into warplets_users (with optional Neynar enrichment)
 * and returns whether they are matched to a Warplet allocation.
 *
 * Body: { fid: number }
 */

interface Env {
  WARPLETS: D1Database;
  NEYNAR_API_KEY?: string;
}

interface RequestBody {
  fid?: unknown;
}

type NeynarUserRecord = {
  username?: string;
  display_name?: string;
  pfp_url?: string;
  registered_at?: string;
  pro_status?: string;
  profile_bio_text?: string;
  follower_count?: number;
  following_count?: number;
  primary_eth_address?: string;
  primary_sol_address?: string;
  x_username?: string;
  url?: string;
  viewer_following?: boolean;
  viewer_followed_by?: boolean;
  score?: number;
};

const NEYNAR_VIEWER_FID = 1129138;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function boolToInt(value: boolean | undefined): number | null {
  if (typeof value !== "boolean") return null;
  return value ? 1 : 0;
}

async function fetchNeynarUserByFid(
  fid: number,
  neynarApiKey?: string
): Promise<NeynarUserRecord | undefined> {
  const apiKey = neynarApiKey?.trim();
  if (!apiKey) return undefined;

  try {
    const endpoint = `https://api.neynar.com/v2/farcaster/user/bulk?viewer_fid=${NEYNAR_VIEWER_FID}&fids=${fid}`;
    const res = await fetch(endpoint, {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) return undefined;

    const payload = (await res.json()) as Record<string, unknown>;
    const users = payload.users;
    if (!Array.isArray(users) || users.length === 0) return undefined;

    const user = asObject(users[0]);
    if (!user) return undefined;

    const pro = asObject(user.pro);
    const profile = asObject(user.profile);
    const bio = asObject(profile?.bio);
    const verifiedAddresses = asObject(user.verified_addresses);
    const primaryAddresses = asObject(verifiedAddresses?.primary);
    const viewerContext = asObject(user.viewer_context);

    let xUsername: string | undefined;
    const verifiedAccounts = user.verified_accounts;
    if (Array.isArray(verifiedAccounts)) {
      for (const account of verifiedAccounts) {
        const verifiedAccount = asObject(account);
        if (!verifiedAccount) continue;
        if (verifiedAccount.platform === "x") {
          xUsername = asString(verifiedAccount.username);
          break;
        }
      }
    }

    return {
      username: asString(user.username),
      display_name: asString(user.display_name),
      pfp_url: asString(user.pfp_url),
      registered_at: asString(user.registered_at),
      pro_status: asString(pro?.status),
      profile_bio_text: asString(bio?.text),
      follower_count: asNumber(user.follower_count),
      following_count: asNumber(user.following_count),
      primary_eth_address: asString(primaryAddresses?.eth_address),
      primary_sol_address: asString(primaryAddresses?.sol_address),
      x_username: xUsername,
      url: asString(user.url),
      viewer_following: asBoolean(viewerContext?.following),
      viewer_followed_by: asBoolean(viewerContext?.followed_by),
      score: asNumber(user.score),
    };
  } catch {
    return undefined;
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: RequestBody = {};
  try {
    body = (await context.request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const fid = typeof body.fid === "number" && Number.isInteger(body.fid) ? body.fid : null;
  if (!fid || fid <= 0) {
    return Response.json({ error: "fid is required" }, { status: 400 });
  }

  const existing = await context.env.WARPLETS.prepare(
    "SELECT id, matched_on, buy_transaction_on, shared_on FROM warplets_users WHERE fid = ? LIMIT 1"
  )
    .bind(fid)
    .first<{ id: number; matched_on: string | null; buy_transaction_on: string | null; shared_on: string | null }>();

  const matchRow = await context.env.WARPLETS.prepare(
    "SELECT x10_rarity FROM warplets_metadata WHERE fid_value = ? LIMIT 1"
  )
    .bind(fid)
    .first<{ x10_rarity: number | null }>();

  const rarityValue = typeof matchRow?.x10_rarity === "number" ? matchRow.x10_rarity : null;
  const isMatch = rarityValue !== null;

  if (!existing) {
    const neynarUser = await fetchNeynarUserByFid(fid, context.env.NEYNAR_API_KEY);
    const now = new Date().toISOString();

    await context.env.WARPLETS.prepare(
      "INSERT INTO warplets_users (" +
        "fid, username, display_name, pfp_url, registered_at, pro_status, profile_bio_text, " +
        "follower_count, following_count, primary_eth_address, primary_sol_address, x_username, " +
        "url, viewer_following, viewer_followed_by, score, matched_on, buy_on, buy_transaction_on, shared_on, created_on, updated_on" +
        ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        fid,
        neynarUser?.username ?? null,
        neynarUser?.display_name ?? null,
        neynarUser?.pfp_url ?? null,
        neynarUser?.registered_at ?? null,
        neynarUser?.pro_status ?? null,
        neynarUser?.profile_bio_text ?? null,
        neynarUser?.follower_count ?? null,
        neynarUser?.following_count ?? null,
        neynarUser?.primary_eth_address ?? null,
        neynarUser?.primary_sol_address ?? null,
        neynarUser?.x_username ?? null,
        neynarUser?.url ?? null,
        boolToInt(neynarUser?.viewer_following),
        boolToInt(neynarUser?.viewer_followed_by),
        neynarUser?.score ?? null,
        isMatch ? now : null,
        null,
        null,
        null,
        now,
        now
      )
      .run();

    return Response.json({
      fid,
      exists: false,
      matched: isMatch,
      rarityValue,
      buyTransactionOn: null,
      sharedOn: null,
    });
  }

  return Response.json({
    fid,
    exists: true,
    matched: isMatch,
    rarityValue,
    buyTransactionOn: existing.buy_transaction_on,
    sharedOn: existing.shared_on,
  });
};