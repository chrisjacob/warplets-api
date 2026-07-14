import { jsonSecure, parseObjectPayload, readJsonBodyWithLimit } from "../_lib/security.js";

interface Env {
  WARPLETS: D1Database;
}

interface FavouritesPayload {
  wallet?: unknown;
  tokenIds?: unknown;
}

const WALLET_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const MAX_TOKEN_ID = 10000;

function normalizeWallet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return WALLET_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeTokenIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<number>();
  const tokenIds: number[] = [];

  for (const raw of value) {
    const tokenId = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > MAX_TOKEN_ID) return null;
    if (!seen.has(tokenId)) {
      seen.add(tokenId);
      tokenIds.push(tokenId);
    }
  }

  return tokenIds;
}

async function loadFavouriteTokenIds(db: D1Database, wallet: string): Promise<number[]> {
  const row = await db
    .prepare("SELECT token_ids FROM warplet_favourites WHERE wallet = ? LIMIT 1")
    .bind(wallet)
    .first<{ token_ids: string | null }>();
  if (!row?.token_ids) return [];

  try {
    return normalizeTokenIds(JSON.parse(row.token_ids)) ?? [];
  } catch {
    return [];
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const wallet = normalizeWallet(url.searchParams.get("wallet"));
  if (!wallet) return jsonSecure({ error: "wallet is required" }, { status: 400 });

  const tokenIds = await loadFavouriteTokenIds(context.env.WARPLETS, wallet);
  return jsonSecure({ wallet, tokenIds });
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const parsed = await readJsonBodyWithLimit<unknown>(context.request, 128 * 1024);
  if (!parsed.ok) return parsed.response;

  const payload = parseObjectPayload<FavouritesPayload>(parsed.value, ["wallet", "tokenIds"]);
  if (!payload.ok) return payload.response;

  const wallet = normalizeWallet(payload.payload.wallet);
  if (!wallet) return jsonSecure({ error: "valid wallet is required" }, { status: 400 });

  const tokenIds = normalizeTokenIds(payload.payload.tokenIds);
  if (!tokenIds) return jsonSecure({ error: "valid tokenIds are required" }, { status: 400 });

  await context.env.WARPLETS
    .prepare(
      `INSERT INTO warplet_favourites (wallet, token_ids)
       VALUES (?, ?)
       ON CONFLICT(wallet) DO UPDATE SET token_ids = excluded.token_ids`,
    )
    .bind(wallet, JSON.stringify(tokenIds))
    .run();

  return jsonSecure({ wallet, tokenIds });
};
