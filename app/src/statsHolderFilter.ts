export function getStatsFriendFilterWallet(search: string): string | null {
  const wallet = new URLSearchParams(search).get("wallet")?.trim().toLowerCase() ?? "";
  return /^0x[a-f0-9]{40}$/.test(wallet) ? wallet : null;
}

export function getStatsFriendFilterFid(search: string): number | null {
  const rawFid = new URLSearchParams(search).get("fid")?.trim() ?? "";
  if (!/^\d+$/.test(rawFid)) return null;
  const fid = Number.parseInt(rawFid, 10);
  return Number.isSafeInteger(fid) && fid > 0 ? fid : null;
}

export function formatStatsFriendFilterLabel(wallet: string | null, fid: number | null): string {
  if (wallet) return `Viewing Friends for ${wallet}`;
  if (fid) return `Viewing Friends for Farcaster FID #${fid.toLocaleString("en-US")}`;
  return "Viewing Friends";
}
