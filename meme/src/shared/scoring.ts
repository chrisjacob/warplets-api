import { ATTRIBUTES, type Attribute } from "./rules";
export const SCALE = 10000n;
export function decimal(units: bigint, scale = SCALE) {
  const whole = units / scale,
    part = (units % scale)
      .toString()
      .padStart(scale.toString().length - 1, "0")
      .replace(/0+$/, "");
  return String(whole) + (part ? "." + part : "");
}
export function boost(input: {
  level: number;
  holdingUnits: bigint;
  streak: number;
  voted: boolean;
}) {
  if (
    !Number.isInteger(input.level) ||
    input.level < 0 ||
    input.level > 10 ||
    !Number.isInteger(input.streak) ||
    input.streak < 0 ||
    input.holdingUnits < 0n ||
    input.holdingUnits > 50000n
  )
    throw Error("Invalid boost input");
  const warplet = BigInt(input.level) * 3000n,
    streak = BigInt(Math.min(10, input.streak)) * 1000n;
  const raw = SCALE + warplet + input.holdingUnits + streak,
    total = raw > 100000n ? 100000n : raw,
    points = input.voted ? total * 10n : 0n;
  return {
    units: total,
    pointUnits: points,
    base: "1",
    warplet: decimal(warplet),
    holding: decimal(input.holdingUnits),
    streak: decimal(streak),
    total: decimal(total),
    points: decimal(points),
  };
}
export function streakLength(
  previousOfferedVotes: boolean[],
  currentValid: boolean,
) {
  if (!currentValid) return 0;
  let count = 1;
  for (const voted of previousOfferedVotes) {
    if (!voted || count === 10) break;
    count++;
  }
  return count;
}
export interface RankedScore {
  fid: number;
  firstValidAt: number;
  candidateId: string;
  rewardWallet: string;
  score: ReturnType<typeof boost>;
}
export function rankScores(scores: RankedScore[]) {
  return [...scores].sort((a, b) =>
    a.score.pointUnits === b.score.pointUnits
      ? a.firstValidAt - b.firstValidAt || a.fid - b.fid
      : a.score.pointUnits > b.score.pointUnits
        ? -1
        : 1,
  );
}
export async function attributeOrder(seed: string): Promise<Attribute[]> {
  if (!/^[a-f0-9]{64}$/.test(seed)) throw Error("Invalid cycle seed");
  const order: Attribute[] = [...ATTRIBUTES];
  let counter = 0;
  for (let i = order.length - 1; i > 0; i--) {
    const bound = i + 1,
      limit = Math.floor(4294967296 / bound) * bound;
    let n: number;
    do {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`10x-attribute-v1:${seed}:${counter++}`),
      );
      n = new DataView(digest).getUint32(0);
    } while (n >= limit);
    const j = n % bound;
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
