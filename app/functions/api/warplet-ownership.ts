import {
  loadMarketOwnership,
  marketJson,
  marketJsonWithEtag,
  type OpenSeaMarketEnv,
} from "../_lib/openseaMarket.js";

export const onRequestGet: PagesFunction<OpenSeaMarketEnv> = async (context) => {
  const url = new URL(context.request.url);
  const wallet = url.searchParams.get("wallet")?.trim() ?? null;
  const rawFid = url.searchParams.get("fid");
  const fid = rawFid && /^\d+$/.test(rawFid) ? Number(rawFid) : null;
  if (!wallet && !fid) {
    return marketJson({ error: "wallet_or_fid_required" }, { status: 400 });
  }

  try {
    const ownership = await loadMarketOwnership(context.env, { wallet, fid });
    return marketJsonWithEtag(ownership, context.request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return marketJson(
      { error: message === "wallet or fid is required" ? "invalid_selector" : "ownership_unavailable" },
      { status: message === "wallet or fid is required" ? 400 : 500 },
    );
  }
};
