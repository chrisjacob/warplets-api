import { DAY_MS } from "./rules";

export interface Recipient {
  fid: number;
  rank: number;
  pointUnits: string;
  rewardWallet: string;
}
export function allocate(total: bigint, recipients: Recipient[]) {
  if (
    total < 0n ||
    recipients.length > 100 ||
    new Set(recipients.map((r) => r.fid)).size !== recipients.length
  )
    throw Error("Invalid allocation");
  const sum = recipients.reduce((n, r) => n + BigInt(r.pointUnits), 0n);
  if (recipients.some((r) => BigInt(r.pointUnits) <= 0n))
    throw Error("Invalid qualifying points");
  if (sum === 0n)
    return {
      recipients: [] as (Recipient & { amount: string })[],
      allocated: "0",
      reserve: String(total),
    };
  const parts = recipients.map((r) => ({
    ...r,
    units: (total * BigInt(r.pointUnits)) / sum,
    remainder: (total * BigInt(r.pointUnits)) % sum,
  }));
  let left = total - parts.reduce((n, r) => n + r.units, 0n);
  const priority = [...parts].sort((a, b) =>
    a.remainder === b.remainder
      ? a.rank - b.rank
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const r of priority) {
    if (left === 0n) break;
    r.units++;
    left--;
  }
  if (left !== 0n) throw Error("Allocation remainder invariant");
  return {
    recipients: parts.map(({ units, remainder, ...r }) => ({
      ...r,
      amount: String(units),
    })),
    allocated: String(total),
    reserve: "0",
  };
}
export function releaseAt(launchedAt: number, index: number) {
  if (!Number.isSafeInteger(index) || index < 1 || index > 10)
    throw Error("Invalid release index");
  return launchedAt + index * DAY_MS;
}
// A closing round serves the following 24-hour release window, excluding close itself.
export function releasesFor(launchedAt: number, closesAt: number) {
  return Array.from({ length: 10 }, (_, i) => i + 1).filter((i) => {
    const at = releaseAt(launchedAt, i);
    return at > closesAt && at <= closesAt + DAY_MS;
  });
}
