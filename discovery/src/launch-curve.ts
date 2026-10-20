// BigInt adaptation of Meteora SDK 1.5.1 concentratedLiquidity.ts at
// 79ebbfe59a225e641a2f37cd03404f26de1b0c8e. MIT, copyright (c) 2026 Meteora.
// Full notice: ../protocol/meteora-MIT-LICENSE.txt. No fee or token-extension logic.
export const Q64 = 1n << 64n, Q128 = 1n << 128n;
export const U64_MAX = (1n << 64n) - 1n, U128_MAX = (1n << 128n) - 1n;
export const MIN_SQRT = 4295048016n, MAX_SQRT = 79226673521066979257578248091n;
export class LaunchError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
export const ceilDiv = (n: bigint, d: bigint) => { if(n<0n||d<=0n)throw new LaunchError("launch_invalid_division");return (n+d-1n)/d; };
export function amountA(lower: bigint, upper: bigint, liquidity: bigint, roundUp = false) {
  if(lower<=0n||upper<lower||liquidity<0n)throw new LaunchError("launch_invalid_range");
  const n=liquidity*(upper-lower),d=lower*upper;return roundUp?ceilDiv(n,d):n/d;
}
export function amountB(lower: bigint, upper: bigint, liquidity: bigint, roundUp = false) {
  if(lower<=0n||upper<lower||liquidity<0n)throw new LaunchError("launch_invalid_range");
  const n=liquidity*(upper-lower);return roundUp?ceilDiv(n,Q128):n/Q128;
}
export function liquidityFromA(amount: bigint, current: bigint, upper: bigint) {
  if(amount<=0n||current<=0n||upper<=current)throw new LaunchError("launch_invalid_range");
  return amount*current*upper/(upper-current);
}
export function curveSwap(lower: bigint, upper: bigint, current: bigint, liquidity: bigint, amount: bigint, aForB: boolean) {
  if(liquidity<=0n||amount<=0n||current<lower||current>upper)throw new LaunchError("launch_invalid_swap");
  const next=aForB?ceilDiv(liquidity*current,liquidity+amount*current):current+amount*Q128/liquidity;
  if(next<lower||next>upper)return null;
  return {next,output:aForB?amountB(next,current,liquidity):amountA(current,next,liquidity)};
}
