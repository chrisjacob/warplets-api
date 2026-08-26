export function getStatsFriendFilterWallet(search: string): string | null {
  const wallet = new URLSearchParams(search).get("wallet")?.trim().toLowerCase() ?? "";
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null;
}
