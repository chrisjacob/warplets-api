import {
  Fraction,
  natural,
  purchaseCredit,
  type Campaign,
  type LedgerEvent,
} from "./holding";

export interface ReplayCheckpoint {
  version: 1;
  total: string;
  balances: [string, string][];
  lots: { n: string; d: string; at: number }[];
  last: { slot: number; signature: string; index: number; at: number } | null;
  count: number;
}
/** Ordered, unique ledger pages. Checkpoints contain exact fractions, never floats. */
export class HoldingReplay {
  private total = 0n;
  private balances = new Map<string, bigint>();
  private lots: { credit: Fraction; at: number }[] = [];
  private last: ReplayCheckpoint["last"] = null;
  private count = 0;
  constructor(
    private campaign: Campaign,
    private wallets: ReadonlySet<string>,
    private cutoff: number,
    state?: ReplayCheckpoint,
  ) {
    if (!state) return;
    if (
      state.version !== 1 ||
      !Number.isSafeInteger(state.count) ||
      state.count < 0
    )
      throw Error("Invalid replay checkpoint");
    const exact = (s: string) => {
      if (!/^(0|[1-9]\d{0,65535})$/.test(s))
        throw Error("Invalid checkpoint fraction");
      return BigInt(s);
    };
    this.total = exact(state.total);
    this.balances = new Map(state.balances.map(([w, b]) => [w, exact(b)]));
    this.lots = state.lots.map((l) => ({
      credit: new Fraction(exact(l.n), exact(l.d)),
      at: l.at,
    }));
    this.last = state.last;
    this.count = state.count;
    if (
      [...this.balances].some(([w]) => !wallets.has(w)) ||
      [...this.balances.values()].reduce((a, b) => a + b, 0n) !== this.total
    )
      throw Error("Replay checkpoint scope or balances differ");
  }
  push(e: LedgerEvent) {
    const p = this.last;
    if (
      p &&
      (e.slot < p.slot ||
        (e.slot === p.slot &&
          (e.signature < p.signature ||
            (e.signature === p.signature && e.index <= p.index))))
    )
      throw Error("Ledger page is duplicate or out of order");
    if (p && e.at < p.at)
      throw Error("Ledger timestamps contradict chain order");
    this.last = {
      slot: e.slot,
      signature: e.signature,
      index: e.index,
      at: e.at,
    };
    this.count++;
    if (e.at > this.cutoff) return;
    const q = natural(e.quantity, true);
    const balance = (w: string, delta: bigint) => {
      const next = (this.balances.get(w) ?? 0n) + delta;
      if (next < 0n) throw Error("Incomplete ledger: negative wallet balance");
      this.balances.set(w, next);
    };
    const dispose = (w: string) => {
      if (q > this.total)
        throw Error("Incomplete ledger: disposal exceeds position");
      balance(w, -q);
      const factor = new Fraction(this.total - q, this.total);
      for (const lot of this.lots) lot.credit = lot.credit.mul(factor);
      this.total -= q;
    };
    if (e.kind === "transfer") {
      if (!e.from || !e.to) throw Error("Transfer endpoints required");
      const from = this.wallets.has(e.from),
        to = this.wallets.has(e.to);
      if (from && to) {
        balance(e.from, -q);
        balance(e.to, q);
      } else if (from) dispose(e.from);
      else if (to) {
        balance(e.to, q);
        this.total += q;
      }
    } else {
      if (!e.wallet) throw Error("Wallet required");
      if (!this.wallets.has(e.wallet)) return;
      if (e.kind === "sell") dispose(e.wallet);
      else {
        balance(e.wallet, q);
        this.total += q;
        if (e.kind === "purchase") {
          if (!e.quote) throw Error("Purchase quote missing");
          this.lots.push({
            credit: purchaseCredit(e.quote),
            at: Math.max(e.at, this.campaign.launchedAt),
          });
        } else if (e.kind !== "airdrop")
          throw Error("Unsupported ledger movement");
      }
    }
  }
  checkpoint(): ReplayCheckpoint {
    return {
      version: 1,
      total: String(this.total),
      balances: [...this.balances]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([w, b]) => [w, String(b)]),
      lots: this.lots.map((l) => ({
        n: String(l.credit.n),
        d: String(l.credit.d),
        at: l.at,
      })),
      last: this.last,
      count: this.count,
    };
  }
  value() {
    const start = this.campaign.launchedAt,
      end = Math.min(this.cutoff, this.campaign.endsAt);
    let at = start,
      credit = new Fraction(0n),
      pointMs = 0n;
    const tier = () =>
      credit.compare(new Fraction(100000000n)) >= 0
        ? 2n
        : credit.compare(new Fraction(10000000n)) >= 0
          ? 1n
          : 0n;
    for (const lot of [...this.lots].sort((a, b) => a.at - b.at)) {
      const next = Math.max(start, Math.min(end, lot.at));
      pointMs += tier() * BigInt(next - at);
      at = next;
      credit = credit.add(lot.credit);
    }
    pointMs += tier() * BigInt(Math.max(0, end - at));
    return { pointMs, eligibleCredit: credit, quantity: this.total };
  }
}
