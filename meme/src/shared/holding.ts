import { canonical } from "./canonical";
export interface Quote {
  paidUnits: string;
  paymentMint: string;
  paymentDecimals: number;
  usdPriceMicros: string;
  at: number;
  source: string;
  evidenceHash: string;
}
export interface LedgerEvent {
  signature: string;
  index: number;
  slot: number;
  at: number;
  kind: "purchase" | "airdrop" | "sell" | "transfer";
  quantity: string;
  wallet?: string;
  from?: string;
  to?: string;
  quote?: Quote;
}
export interface Campaign {
  id: string;
  mint: string;
  symbol: string;
  launchedAt: number;
  endsAt: number;
  totalSupply: string;
  decimals: number;
  mode: "observed" | "simulated";
}
const gcd = (a: bigint, b: bigint): bigint => (b ? gcd(b, a % b) : a);
export class Fraction {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d = 1n) {
    if (d <= 0n || n < 0n) throw Error("Invalid nonnegative fraction");
    const g = gcd(n, d);
    this.n = n / g;
    this.d = d / g;
  }
  add(x: Fraction) {
    return new Fraction(this.n * x.d + x.n * this.d, this.d * x.d);
  }
  mul(x: Fraction) {
    return new Fraction(this.n * x.n, this.d * x.d);
  }
  compare(x: Fraction) {
    return this.n * x.d < x.n * this.d
      ? -1
      : this.n * x.d > x.n * this.d
        ? 1
        : 0;
  }
  toJSON() {
    return { numerator: String(this.n), denominator: String(this.d) };
  }
}
export function natural(value: string, positive = false) {
  if (!/^(0|[1-9]\d{0,77})$/.test(value)) throw Error("Invalid integer amount");
  const n = BigInt(value);
  if (positive && n === 0n) throw Error("Positive amount required");
  return n;
}
export function purchaseCredit(quote: Quote) {
  return new Fraction(
    natural(quote.paidUnits, true) * natural(quote.usdPriceMicros, true),
    10n ** BigInt(quote.paymentDecimals),
  );
}
interface Lot {
  credit: Fraction;
  acquiredAt: number;
}
export function replayHolding(
  campaign: Campaign,
  events: LedgerEvent[],
  wallets: ReadonlySet<string>,
  cutoff: number,
) {
  const balances = new Map<string, bigint>(),
    lots: Lot[] = [];
  let total = 0n;
  const seen = new Map<string, string>();
  const sorted = [...events].sort(
    (a, b) =>
      a.slot - b.slot ||
      (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0) ||
      a.index - b.index,
  );
  let lastAt = 0;
  function balance(wallet: string, delta: bigint) {
    const next = (balances.get(wallet) ?? 0n) + delta;
    if (next < 0n) throw Error("Incomplete ledger: negative wallet balance");
    balances.set(wallet, next);
  }
  function dispose(wallet: string, q: bigint) {
    if (q > total) throw Error("Incomplete ledger: disposal exceeds position");
    balance(wallet, -q);
    const factor = new Fraction(total - q, total);
    for (const lot of lots) lot.credit = lot.credit.mul(factor);
    total -= q;
  }
  for (const e of sorted) {
    const key = e.signature + ":" + e.index,
      bytes = canonical(e);
    if (seen.has(key)) {
      if (seen.get(key) !== bytes) throw Error("Conflicting ledger event");
      continue;
    }
    seen.set(key, bytes);
    if (e.at < lastAt) throw Error("Ledger timestamps contradict chain order");
    lastAt = e.at;
    if (e.at > cutoff) continue;
    const q = natural(e.quantity, true);
    if (e.kind === "transfer") {
      if (!e.from || !e.to) throw Error("Transfer endpoints required");
      const from = wallets.has(e.from),
        to = wallets.has(e.to);
      if (from && to) {
        balance(e.from, -q);
        balance(e.to, q);
      } else if (from) dispose(e.from, q);
      else if (to) {
        balance(e.to, q);
        total += q;
      }
      continue;
    }
    if (!e.wallet) throw Error("Wallet required");
    if (!wallets.has(e.wallet)) continue;
    if (e.kind === "sell") dispose(e.wallet, q);
    else {
      balance(e.wallet, q);
      total += q;
      if (e.kind === "purchase") {
        if (!e.quote) throw Error("Purchase quote missing");
        lots.push({
          credit: purchaseCredit(e.quote),
          acquiredAt: Math.max(e.at, campaign.launchedAt),
        });
      }
    }
  }
  const end = Math.min(cutoff, campaign.endsAt),
    start = campaign.launchedAt;
  const changes = [
    ...new Set([
      start,
      end,
      ...lots.map((l) => l.acquiredAt).filter((at) => at > start && at < end),
    ]),
  ].sort((a, b) => a - b);
  let pointMs = 0n;
  const orderedLots = [...lots].sort((a, b) => a.acquiredAt - b.acquiredAt);
  let credit = new Fraction(0n),
    cursor = 0;
  for (let i = 0; i < changes.length - 1; i++) {
    const at = changes[i];
    while (cursor < orderedLots.length && orderedLots[cursor].acquiredAt <= at)
      credit = credit.add(orderedLots[cursor++].credit);
    const tier =
      credit.compare(new Fraction(100000000n)) >= 0
        ? 2n
        : credit.compare(new Fraction(10000000n)) >= 0
          ? 1n
          : 0n;
    pointMs += tier * BigInt(changes[i + 1] - at);
  }
  return {
    pointMs,
    eligibleCredit: lots.reduce(
      (sum, l) => sum.add(l.credit),
      new Fraction(0n),
    ),
    quantity: total,
    balances,
    lots,
  };
}
export function normalizedHolding(
  campaigns: Campaign[],
  eventMap: Map<string, LedgerEvent[]>,
  wallets: ReadonlySet<string>,
  cutoff: number,
) {
  let numerator = 0n,
    denominator = 0n;
  const detail: Record<
    string,
    {
      pointMs: string;
      eligibleCredit: ReturnType<Fraction["toJSON"]>;
      quantity: string;
    }
  > = {};
  for (const c of campaigns) {
    if (c.launchedAt >= cutoff || c.endsAt < cutoff) continue;
    const value = replayHolding(c, eventMap.get(c.id) ?? [], wallets, cutoff);
    numerator += value.pointMs;
    denominator += 2n * BigInt(Math.min(cutoff, c.endsAt) - c.launchedAt);
    detail[c.id] = {
      pointMs: String(value.pointMs),
      eligibleCredit: value.eligibleCredit.toJSON(),
      quantity: String(value.quantity),
    };
  }
  const units = denominator === 0n ? 0n : (50000n * numerator) / denominator;
  return {
    units: units > 50000n ? 50000n : units,
    numerator: String(numerator),
    denominator: String(denominator),
    detail,
  };
}
