import { isAddress } from "viem";
import { jsonSecure } from "../_lib/security.js";
import { resolveWalletProfiles, type WalletProfileEnv } from "../_lib/walletProfiles.js";

export const onRequestGet: PagesFunction<WalletProfileEnv> = async (context) => {
  const rawAddress = new URL(context.request.url).searchParams.get("address")?.trim() ?? "";
  if (!isAddress(rawAddress)) {
    return jsonSecure({ error: "invalid_wallet" }, { status: 400 });
  }

  try {
    const force = new URL(context.request.url).searchParams.get("refresh") === "1";
    const profile = (await resolveWalletProfiles(context.env, [rawAddress], { force })).values().next().value;
    return jsonSecure(
      { address: rawAddress.toLowerCase(), name: profile?.ensName ?? null, avatarUrl: profile?.avatarUrl ?? null, avatarSource: profile?.avatarSource ?? "none" },
      { headers: { "cache-control": force ? "no-store" : "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (error) {
    console.warn("ENS wallet profile lookup failed", error);
    return jsonSecure(
      { address: rawAddress.toLowerCase(), name: null, avatarUrl: null },
      { headers: { "cache-control": "public, max-age=60, s-maxage=300" } },
    );
  }
};
