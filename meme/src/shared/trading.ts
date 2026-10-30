import { Exact, zero } from "./exact";
import { decode58 } from "./base58";
export type TradingWindow = "24h" | "30d" | "all";
export interface TraderEvidence {
  version: 1;
  fid: number;
  wallets: string[];
  verifiedAt: number;
  throughAt: number;
  complete: boolean;
  gaps: string[];
  sourceHash: string;
  mode: "simulated" | "observed";
  markets: { id: string; attnMint: string; ogMint: string }[];
  events: TradeEvent[];
}
export interface TradeEvent {
  id: string;
  at: number;
  slot: number;
  index: number;
  wallet: string;
  marketId: string;
  kind: "buy" | "sell" | "external-in" | "external-out" | "self-transfer";
  quantity: string;
  destination?: string;
  /** USD and OG paid/received, before separately declared fees. Fee quote includes ALL allocated network/priority fees. */
  usd?: string;
  og?: string;
  feeUsd?: string;
  feeOg?: string;
  signature: string;
  evidenceHash: string;
  finalized: true;
}
interface Inventory {
  purchased: Exact;
  excluded: Exact;
  usd: Exact;
  og: Exact;
}
export interface Realization {
  id: string;
  at: number;
  marketId: string;
  ogMint: string;
  proceeds: Exact;
  cost: Exact;
  pnl: Exact;
  ogPnl: Exact;
}
export interface TradingMetrics {
  fid: number;
  pnlUsd: string;
  costUsd: string;
  proceedsUsd: string;
  roiPercent: string | null;
  sells: number;
  wins: number;
  ogGains: { mint: string; amount: string }[];
  exactPnl: { numerator: string; denominator: string };
}
const nonnegative = (s: string | undefined) => {
  const n = Exact.decimal(s ?? "");
  if (n.n < 0n) throw Error("Negative trade value");
  return n;
};
function empty(): Inventory {
  return { purchased: zero(), excluded: zero(), usd: zero(), og: zero() };
}
/** Full-history moving-average replay. Window filters realized sales, never the acquisition history. */
export function replayTrading(input: TraderEvidence): Realization[] {
  if (
    !input ||
    input.version !== 1 ||
    !Number.isSafeInteger(input.fid) ||
    input.fid < 1 ||
    !["observed", "simulated"].includes(input.mode) ||
    !/^[a-f0-9]{64}$/.test(input.sourceHash) ||
    !Number.isSafeInteger(input.verifiedAt) ||
    input.verifiedAt < 0 ||
    !Number.isSafeInteger(input.throughAt) ||
    input.throughAt < input.verifiedAt ||
    !input.complete ||
    !Array.isArray(input.gaps) ||
    input.gaps.length
  )
    throw Error("Complete verified source coverage required");
  if (
    !Array.isArray(input.wallets) ||
    !input.wallets.length ||
    input.wallets.length > 20 ||
    new Set(input.wallets).size !== input.wallets.length ||
    !Array.isArray(input.events) ||
    input.events.length > 10000 ||
    !Array.isArray(input.markets) ||
    input.markets.length > 100
  )
    throw Error("Bounded unique wallet/market evidence required");
  input.wallets.forEach((w) => decode58(w, 32));
  const markets = new Map(
    input.markets.map((m) => {
      decode58(m.attnMint, 32);
      decode58(m.ogMint, 32);
      if (
        !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/.test(m.id) ||
        m.attnMint === m.ogMint
      )
        throw Error("Invalid ATTN market");
      return [m.id, m] as const;
    }),
  );
  if (
    markets.size !== input.markets.length ||
    new Set(input.markets.map((m) => m.attnMint)).size !== markets.size
  )
    throw Error("Duplicate trading market");
  const inventories = new Map<string, Inventory>(),
    ids = new Set<string>(),
    positions = new Set<string>(),
    results: Realization[] = [];
  const get = (wallet: string, market: string) => {
    const key = wallet + ":" + market;
    if (!inventories.has(key)) inventories.set(key, empty());
    return inventories.get(key)!;
  };
  const ordered = [...input.events].sort(
    (a, b) => a.slot - b.slot || a.index - b.index || a.id.localeCompare(b.id),
  );
  let lastAt = 0;
  for (const e of ordered) {
    if (
      !e ||
      !markets.has(e.marketId) ||
      !input.wallets.includes(e.wallet) ||
      !/^[A-Za-z0-9:._-]{1,200}$/.test(e.id) ||
      ids.has(e.id) ||
      !Number.isSafeInteger(e.at) ||
      e.at < lastAt ||
      e.at > input.throughAt ||
      !Number.isSafeInteger(e.slot) ||
      e.slot < 1 ||
      !Number.isSafeInteger(e.index) ||
      e.index < 0 ||
      !/^[a-f0-9]{64}$/.test(e.evidenceHash) ||
      e.finalized !== true
    )
      throw Error("Invalid, duplicate or non-finalized trade evidence");
    decode58(e.signature, 64);
    // One normalized event per chain position: a parser cannot count the same fill twice under a new id.
    const position = e.signature + ":" + e.index;
    if (positions.has(position))
      throw Error("Duplicate normalized chain event");
    positions.add(position);
    ids.add(e.id);
    lastAt = e.at;
    const q = nonnegative(e.quantity);
    if (q.n === 0n) throw Error("Zero quantity");
    const current = get(e.wallet, e.marketId);
    if (e.kind === "buy") {
      const cost = nonnegative(e.usd).add(nonnegative(e.feeUsd)),
        og = nonnegative(e.og).add(nonnegative(e.feeOg));
      if (cost.n === 0n || og.n === 0n || e.destination !== undefined)
        throw Error("Purchase cost evidence required");
      current.purchased = current.purchased.add(q);
      current.usd = current.usd.add(cost);
      current.og = current.og.add(og);
      continue;
    }
    if (e.kind === "external-in") {
      if (
        [e.usd, e.og, e.feeUsd, e.feeOg, e.destination].some(
          (v) => v !== undefined,
        )
      )
        throw Error("Deposits have no trade cost/profit");
      current.excluded = current.excluded.add(q);
      continue;
    }
    if (!["sell", "external-out", "self-transfer"].includes(e.kind))
      throw Error("Unsupported transaction blocks trading coverage");
    const total = current.purchased.add(current.excluded);
    if (q.compare(total) > 0) throw Error("Missing inventory history");
    const ratio = q.div(total),
      purchased = current.purchased.mul(ratio),
      excluded = current.excluded.mul(ratio),
      cost = current.usd.mul(ratio),
      ogCost = current.og.mul(ratio);
    if (e.kind === "sell") {
      if (e.destination !== undefined) throw Error("Unexpected destination");
      const net = nonnegative(e.usd).sub(nonnegative(e.feeUsd)),
        ogNet = nonnegative(e.og).sub(nonnegative(e.feeOg));
      // Attribute both proceeds and costs proportionally; free/reward tokens never create trading profits.
      if (purchased.n !== 0n) {
        const share = purchased.div(q),
          proceeds = net.mul(share);
        results.push({
          id: e.id,
          at: e.at,
          marketId: e.marketId,
          ogMint: markets.get(e.marketId)!.ogMint,
          proceeds,
          cost,
          pnl: proceeds.sub(cost),
          ogPnl: ogNet.mul(share).sub(ogCost),
        });
      }
    } else {
      if ([e.usd, e.og, e.feeUsd, e.feeOg].some((v) => v !== undefined))
        throw Error("Transfers cannot manufacture proceeds");
      if (e.kind === "self-transfer") {
        if (
          !e.destination ||
          e.destination === e.wallet ||
          !input.wallets.includes(e.destination)
        )
          throw Error("Self-transfer needs a second verified wallet");
        const destination = get(e.destination, e.marketId);
        destination.purchased = destination.purchased.add(purchased);
        destination.excluded = destination.excluded.add(excluded);
        destination.usd = destination.usd.add(cost);
        destination.og = destination.og.add(ogCost);
      } else if (e.destination !== undefined)
        throw Error("External destination is not a verified self-transfer");
    }
    current.purchased = current.purchased.sub(purchased);
    current.excluded = current.excluded.sub(excluded);
    current.usd = current.usd.sub(cost);
    current.og = current.og.sub(ogCost);
  }
  return results;
}
export function tradingMetrics(
  input: TraderEvidence,
  window: TradingWindow,
  asOf: number,
): TradingMetrics {
  if (
    !["24h", "30d", "all"].includes(window) ||
    !Number.isSafeInteger(asOf) ||
    asOf > input.throughAt ||
    asOf < input.verifiedAt
  )
    throw Error("Invalid trading window");
  const from =
    window === "all" ? 0 : asOf - (window === "24h" ? 86400000 : 2592000000);
  let pnl = zero(),
    cost = zero(),
    proceeds = zero(),
    wins = 0,
    sells = 0;
  const og = new Map<string, Exact>();
  for (const r of replayTrading(input))
    if (r.at >= from && r.at <= asOf) {
      pnl = pnl.add(r.pnl);
      cost = cost.add(r.cost);
      proceeds = proceeds.add(r.proceeds);
      sells++;
      if (r.pnl.n > 0n) wins++;
      og.set(r.ogMint, (og.get(r.ogMint) ?? zero()).add(r.ogPnl));
    }
  return {
    fid: input.fid,
    pnlUsd: pnl.decimal(),
    costUsd: cost.decimal(),
    proceedsUsd: proceeds.decimal(),
    roiPercent: cost.n ? pnl.div(cost).mul(new Exact(100n)).decimal() : null,
    sells,
    wins,
    ogGains: [...og]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mint, amount]) => ({ mint, amount: amount.decimal() })),
    exactPnl: pnl.toJSON(),
  };
}
export function rankTraders(metrics: TradingMetrics[]) {
  return [...metrics]
    .filter((r) => r.sells > 0)
    .sort(
      (a, b) =>
        Exact.json(b.exactPnl).compare(Exact.json(a.exactPnl)) || a.fid - b.fid,
    )
    .slice(0, 100)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
