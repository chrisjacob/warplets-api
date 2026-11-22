export interface Entitlement {
  edition_id: string;
  symbol: string;
  decimals: number;
  amount: string;
  release_at: number;
  state: string;
  reward_wallet: string;
  mode: string;
}
export function tokenAmount(raw: string, decimals: number) {
  if (
    !/^\d+$/.test(raw) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  )
    throw Error("Invalid token amount");
  const padded = raw.padStart(decimals + 1, "0"),
    whole = decimals ? padded.slice(0, -decimals) : padded,
    fraction = decimals ? padded.slice(-decimals).replace(/0+$/, "") : "";
  return (
    whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (fraction ? "." + fraction : "")
  );
}
export function rewardTotals(rows: Entitlement[]) {
  const result = new Map<string, Entitlement>();
  for (const row of rows) {
    const key = JSON.stringify([row.edition_id, row.reward_wallet, row.mode]);
    const old = result.get(key);
    if (old) {
      if (old.decimals !== row.decimals)
        throw Error("Inconsistent token decimals");
      old.amount = String(BigInt(old.amount) + BigInt(row.amount));
      old.release_at = Math.max(old.release_at, row.release_at);
    } else result.set(key, { ...row });
  }
  return [...result.values()];
}
