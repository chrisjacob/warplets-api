export type WarpletOwner = {
  wallet: string | null;
  fid: number | null;
  checkedAt: string | null;
  username?: string | null;
  displayName?: string | null;
  pfpUrl?: string | null;
  bio?: string | null;
  followerCount?: number | null;
  followingCount?: number | null;
};

function normalizedWallet(owner: WarpletOwner | null | undefined): string {
  return owner?.wallet?.trim().toLowerCase() ?? "";
}

export function resolveEffectiveWarpletOwner(
  freshOwner: WarpletOwner | null | undefined,
  cachedOwner: WarpletOwner | null | undefined,
): WarpletOwner | null {
  if (!freshOwner) return cachedOwner ?? null;

  const freshWallet = normalizedWallet(freshOwner);
  const cachedWallet = normalizedWallet(cachedOwner);

  // A failed live RPC lookup is not evidence that the token has no owner.
  if (!freshWallet) return cachedOwner ?? freshOwner;

  if (cachedOwner && cachedWallet === freshWallet) {
    return {
      ...cachedOwner,
      ...freshOwner,
      fid: freshOwner.fid ?? cachedOwner.fid,
      checkedAt: freshOwner.checkedAt ?? cachedOwner.checkedAt,
    };
  }

  return freshOwner;
}
