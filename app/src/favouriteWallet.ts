export function resolveActiveFavouriteWallet(
  favouriteIdentityWallet: string | null | undefined,
  connectedWallet: string | null | undefined,
): string | null {
  return favouriteIdentityWallet || connectedWallet || null;
}
