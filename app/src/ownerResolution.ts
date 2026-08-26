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

function normalizedWallet(owner: Pick<WarpletOwner, "wallet"> | null | undefined): string {
  return owner?.wallet?.trim().toLowerCase() ?? "";
}

export function findRarestOwnedWarpletTokenId(
  owners: Record<string, Pick<WarpletOwner, "wallet" | "fid">>,
  identity: { wallet?: string | null; fid?: number | null },
): number | null {
  const wallet = identity.wallet?.trim().toLowerCase() ?? "";
  const fid = Number.isInteger(identity.fid) && Number(identity.fid) > 0
    ? Number(identity.fid)
    : null;

  const tokenId = Object.entries(owners)
    .filter(([, owner]) => wallet
      ? normalizedWallet(owner) === wallet
      : fid != null && owner.fid === fid)
    .map(([rawTokenId]) => Number(rawTokenId))
    .filter((candidate) => Number.isInteger(candidate) && candidate > 0)
    .sort((left, right) => left - right)[0];

  return tokenId ?? null;
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
