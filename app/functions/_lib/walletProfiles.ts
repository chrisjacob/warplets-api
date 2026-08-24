import { createPublicClient, getAddress, http, isAddress } from "viem";
import { mainnet } from "viem/chains";

export interface WalletProfileEnv {
  WARPLETS: D1Database;
  OPENSEA_API_KEY?: string;
}

export interface ResolvedWalletProfile {
  wallet: string;
  avatarUrl: string | null;
  avatarSource: "farcaster" | "opensea" | "ens" | "none";
  ensName: string | null;
  openseaUsername: string | null;
}

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OPENSEA_API_BASE = "https://api.opensea.io/api/v2";
const ensClient = createPublicClient({ chain: mainnet, transport: http() });

function normalizeWallet(value: string): string | null {
  return isAddress(value) ? getAddress(value).toLowerCase() : null;
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function resolveFallback(env: WalletProfileEnv, wallet: string): Promise<ResolvedWalletProfile> {
  let openseaAvatar: string | null = null;
  let openseaUsername: string | null = null;
  const apiKey = env.OPENSEA_API_KEY?.trim();
  if (apiKey) {
    try {
      const response = await fetch(`${OPENSEA_API_BASE}/accounts/${encodeURIComponent(wallet)}`, {
        headers: { accept: "application/json", "x-api-key": apiKey },
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        const account = await response.json() as Record<string, unknown>;
        openseaAvatar = clean(account.profile_image_url ?? account.profileImageUrl ?? account.image_url);
        openseaUsername = clean(account.username ?? (account.user as Record<string, unknown> | undefined)?.username);
      }
    } catch { /* ENS remains available as the next fallback */ }
  }

  let ensName: string | null = null;
  let ensAvatar: string | null = null;
  try {
    ensName = await ensClient.getEnsName({ address: getAddress(wallet) });
    ensAvatar = ensName ? await ensClient.getEnsAvatar({ name: ensName }) : null;
  } catch { /* identicon is rendered by the client */ }

  const avatarUrl = openseaAvatar ?? ensAvatar;
  const avatarSource = openseaAvatar ? "opensea" : ensAvatar ? "ens" : "none";
  const now = new Date().toISOString();
  await env.WARPLETS.prepare(
    `INSERT INTO wallet_profile_cache (
       wallet, opensea_avatar_url, opensea_username, ens_name, ens_avatar_url,
       resolved_avatar_url, resolved_source, checked_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(wallet) DO UPDATE SET
       opensea_avatar_url = excluded.opensea_avatar_url,
       opensea_username = excluded.opensea_username,
       ens_name = excluded.ens_name,
       ens_avatar_url = excluded.ens_avatar_url,
       resolved_avatar_url = excluded.resolved_avatar_url,
       resolved_source = excluded.resolved_source,
       checked_at = excluded.checked_at,
       updated_at = excluded.updated_at`,
  ).bind(wallet, openseaAvatar, openseaUsername, ensName, ensAvatar, avatarUrl, avatarSource, now, now).run().catch(() => undefined);
  return { wallet, avatarUrl, avatarSource, ensName, openseaUsername };
}

export async function resolveWalletProfiles(
  env: WalletProfileEnv,
  rawWallets: Iterable<string>,
  options: { force?: boolean } = {},
): Promise<Map<string, ResolvedWalletProfile>> {
  const wallets = [...new Set([...rawWallets].map(normalizeWallet).filter((wallet): wallet is string => Boolean(wallet)))];
  const resolved = new Map<string, ResolvedWalletProfile>();
  if (wallets.length === 0) return resolved;

  // Farcaster is always authoritative and is read from the existing local cache.
  const farcaster = await env.WARPLETS.prepare(
    `WITH ranked AS (
       SELECT LOWER(wallet) wallet, pfp_url,
              ROW_NUMBER() OVER (PARTITION BY LOWER(wallet) ORDER BY COALESCE(score, -1) DESC, fid ASC) profile_rank
       FROM wallet_farcaster_links
       WHERE LOWER(wallet) IN (SELECT LOWER(CAST(value AS TEXT)) FROM json_each(?))
         AND pfp_url IS NOT NULL AND TRIM(pfp_url) <> ''
     ) SELECT wallet, pfp_url FROM ranked WHERE profile_rank = 1`,
  ).bind(JSON.stringify(wallets)).all<{ wallet: string; pfp_url: string }>().catch(() => ({ results: [] }));
  for (const row of farcaster.results ?? []) {
    resolved.set(row.wallet.toLowerCase(), {
      wallet: row.wallet.toLowerCase(), avatarUrl: row.pfp_url, avatarSource: "farcaster", ensName: null, openseaUsername: null,
    });
  }

  const missing = wallets.filter((wallet) => !resolved.has(wallet));
  if (!options.force && missing.length > 0) {
    const cached = await env.WARPLETS.prepare(
      `SELECT wallet, resolved_avatar_url, resolved_source, ens_name, opensea_username, checked_at
       FROM wallet_profile_cache
       WHERE wallet IN (SELECT LOWER(CAST(value AS TEXT)) FROM json_each(?))`,
    ).bind(JSON.stringify(missing)).all<{
      wallet: string; resolved_avatar_url: string | null; resolved_source: string; ens_name: string | null; opensea_username: string | null; checked_at: string;
    }>().catch(() => ({ results: [] }));
    for (const row of cached.results ?? []) {
      if (Date.now() - Date.parse(row.checked_at) > CACHE_TTL_MS) continue;
      resolved.set(row.wallet, {
        wallet: row.wallet,
        avatarUrl: row.resolved_avatar_url,
        avatarSource: row.resolved_source === "opensea" ? "opensea" : row.resolved_source === "ens" ? "ens" : "none",
        ensName: row.ens_name,
        openseaUsername: row.opensea_username,
      });
    }
  }

  // Result sets are bounded before reaching here. Resolve in small batches to
  // avoid an OpenSea/ENS request burst when a page contains many wallets.
  const unresolved = missing.filter((wallet) => !resolved.has(wallet)).slice(0, 30);
  for (let index = 0; index < unresolved.length; index += 5) {
    const batch = await Promise.all(unresolved.slice(index, index + 5).map((wallet) => resolveFallback(env, wallet)));
    for (const profile of batch) resolved.set(profile.wallet, profile);
  }
  return resolved;
}
