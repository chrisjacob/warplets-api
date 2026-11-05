/** Signed exact arithmetic for display/trading metrics; reward accounting is unchanged. */
const gcd = (a: bigint, b: bigint): bigint =>
  b ? gcd(b, a % b) : a < 0n ? -a : a;
export class Exact {
  readonly n: bigint;
  readonly d: bigint;
  constructor(n: bigint, d = 1n) {
    if (d === 0n) throw Error("Zero denominator");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    this.n = n / g;
    this.d = d / g;
  }
  static decimal(value: string) {
    if (
      typeof value !== "string" ||
      !/^-?(?:0|[1-9]\d{0,41})(?:\.\d{1,24})?$/.test(value)
    )
      throw Error("Invalid exact decimal");
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(
      ".",
    );
    return new Exact(
      BigInt(whole + fraction) * (negative ? -1n : 1n),
      10n ** BigInt(fraction.length),
    );
  }
  static json(value: { numerator: string; denominator: string }) {
    if (
      !/^-?\d{1,4096}$/.test(value.numerator) ||
      !/^\d{1,4096}$/.test(value.denominator)
    )
      throw Error("Invalid fraction checkpoint");
    return new Exact(BigInt(value.numerator), BigInt(value.denominator));
  }
  add(x: Exact) {
    return new Exact(this.n * x.d + x.n * this.d, this.d * x.d);
  }
  sub(x: Exact) {
    return new Exact(this.n * x.d - x.n * this.d, this.d * x.d);
  }
  mul(x: Exact) {
    return new Exact(this.n * x.n, this.d * x.d);
  }
  div(x: Exact) {
    return new Exact(this.n * x.d, this.d * x.n);
  }
  compare(x: Exact) {
    const n = this.n * x.d - x.n * this.d;
    return n < 0n ? -1 : n > 0n ? 1 : 0;
  }
  decimal(places = 18) {
    if (!Number.isInteger(places) || places < 0 || places > 24)
      throw Error("Invalid precision");
    const scaled = (this.n * 10n ** BigInt(places)) / this.d;
    const absolute = scaled < 0n ? -scaled : scaled;
    const s = absolute.toString().padStart(places + 1, "0");
    return (
      (scaled < 0n ? "-" : "") +
      (places ? s.slice(0, -places) + "." + s.slice(-places) : s).replace(
        /\.0+$|(?<=\.[0-9]*?)0+$/g,
        "",
      )
    );
  }
  toJSON() {
    return { numerator: this.n.toString(), denominator: this.d.toString() };
  }
}
export const zero = () => new Exact(0n);
