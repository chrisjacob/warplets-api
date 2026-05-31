interface Env {
  WARPLETS: D1Database;
}

type RecentBuyerRow = {
  fid: number | null;
  pfp_url: string | null;
  score: number | null;
  buy_in_opensea_on?: string | null;
  buy_in_farcaster_wallet_on?: string | null;
  matched_on?: string | null;
  buyer_on?: string | null;
};

type MetadataAvatarRow = {
  fid_value: number | null;
  token_id: number;
  jpg_url: string | null;
};

type RecentBuyer = {
  fid: number;
  pfpUrl: string;
  score: number | null;
};

function normalizeAndRank(rows: RecentBuyerRow[], recencyField: "buyer_on" | "matched_on"): RecentBuyer[] {
  return rows
    .filter((row) => typeof row.fid === "number" && typeof row.pfp_url === "string" && row.pfp_url.trim().length > 0)
    .sort((a, b) => {
      const aScore = typeof a.score === "number" ? a.score : -1;
      const bScore = typeof b.score === "number" ? b.score : -1;
      if (bScore !== aScore) return bScore - aScore;

      // Keep recency as deterministic tie-breaker for equal scores.
      const aRecency = (a[recencyField] ?? "") as string;
      const bRecency = (b[recencyField] ?? "") as string;
      return bRecency.localeCompare(aRecency);
    })
    .slice(0, 10)
    .map((row) => ({
      fid: row.fid as number,
      pfpUrl: row.pfp_url as string,
      score: typeof row.score === "number" ? row.score : null,
    }));
}

async function fetchProdMatchedFallback(): Promise<RecentBuyer[] | null> {
  try {
    const res = await fetch("https://drop.10x.meme/api/recent-buys?mode=matched");
    if (!res.ok) return null;

    const payload = (await res.json()) as { buyers?: unknown };
    if (!Array.isArray(payload.buyers)) return null;

    const buyers = payload.buyers
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as { fid?: unknown; pfpUrl?: unknown; score?: unknown };
        if (typeof row.fid !== "number" || !Number.isFinite(row.fid)) return null;
        if (typeof row.pfpUrl !== "string" || row.pfpUrl.trim().length === 0) return null;
        return {
          fid: row.fid,
          pfpUrl: row.pfpUrl,
          score: typeof row.score === "number" && Number.isFinite(row.score) ? row.score : null,
        } satisfies RecentBuyer;
      })
      .filter((item): item is RecentBuyer => item !== null)
      .slice(0, 10);

    return buyers.length > 0 ? buyers : null;
  } catch {
    return null;
  }
}

async function loadLocalPlaceholderBuyers(db: D1Database): Promise<RecentBuyer[]> {
  const latest = await db.prepare(
    `SELECT fid_value, token_id, jpg_url
     FROM warplets_metadata
     WHERE fid_value IS NOT NULL
     ORDER BY token_id DESC
     LIMIT 25`
  ).all<MetadataAvatarRow>();

  const seen = new Set<number>();
  const buyers: RecentBuyer[] = [];
  for (const row of latest.results ?? []) {
    if (typeof row.fid_value !== "number" || seen.has(row.fid_value)) continue;
    const pfpUrl = row.jpg_url?.trim() || `https://warplets.10x.meme/${row.token_id}.jpg`;
    buyers.push({ fid: row.fid_value, pfpUrl, score: null });
    seen.add(row.fid_value);
    if (buyers.length >= 10) break;
  }
  return buyers;
}

function isLocalDevHost(hostname: string): boolean {
  return (
    hostname.includes("-local.") ||
    hostname.includes("-dev.") ||
    hostname.endsWith(".pages.dev") ||
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1"
  );
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const mode = (url.searchParams.get("mode") || "buyers").toLowerCase();

  if (mode === "matched") {
    const matchedQuery = await context.env.WARPLETS.prepare(
      "SELECT fid, pfp_url, score, matched_on " +
        "FROM warplets_users " +
        "WHERE matched_on IS NOT NULL AND pfp_url IS NOT NULL AND fid IS NOT NULL " +
        "ORDER BY matched_on DESC LIMIT 100"
    ).all<RecentBuyerRow>();

    const matchedRows = Array.isArray(matchedQuery.results) ? matchedQuery.results : [];
    const matchedBuyers = normalizeAndRank(matchedRows, "matched_on");
    return Response.json({ buyers: matchedBuyers });
  }

  const buyersQuery = await context.env.WARPLETS.prepare(
    "SELECT fid, pfp_url, score, COALESCE(buy_in_opensea_on, buy_in_farcaster_wallet_on) AS buyer_on " +
      "FROM warplets_users " +
      "WHERE (buy_in_opensea_on IS NOT NULL OR buy_in_farcaster_wallet_on IS NOT NULL) AND pfp_url IS NOT NULL AND fid IS NOT NULL " +
      "ORDER BY buyer_on DESC LIMIT 100"
  ).all<RecentBuyerRow>();

  const buyerRows = Array.isArray(buyersQuery.results) ? buyersQuery.results : [];
  const rankedBuyers = normalizeAndRank(buyerRows, "buyer_on");
  if (rankedBuyers.length > 0) {
    return Response.json({ buyers: rankedBuyers });
  }

  // Testing fallback: when local buyers are empty, try prod matched users first.
  const prodFallback = await fetchProdMatchedFallback();
  if (prodFallback && prodFallback.length > 0) {
    return Response.json({ buyers: prodFallback, source: "prod-matched-fallback" });
  }

  // Last fallback: local matched users.
  const matchedQuery = await context.env.WARPLETS.prepare(
    "SELECT fid, pfp_url, score, matched_on " +
      "FROM warplets_users " +
      "WHERE matched_on IS NOT NULL AND pfp_url IS NOT NULL AND fid IS NOT NULL " +
      "ORDER BY matched_on DESC LIMIT 100"
  ).all<RecentBuyerRow>();

  const matchedRows = Array.isArray(matchedQuery.results) ? matchedQuery.results : [];
  const matchedBuyers = normalizeAndRank(matchedRows, "matched_on");
  if (matchedBuyers.length === 0 && isLocalDevHost(url.hostname)) {
    return Response.json({ buyers: await loadLocalPlaceholderBuyers(context.env.WARPLETS), source: "local-placeholder-fallback" });
  }
  return Response.json({ buyers: matchedBuyers, source: "local-matched-fallback" });
};
