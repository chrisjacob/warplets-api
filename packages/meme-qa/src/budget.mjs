/** Exact native units. No token purchase, swap, liquidity or custody permission is implied. */
export function estimateBudget({ base = [], solana = [], retryBps = 2500 }) {
  if (!Number.isSafeInteger(retryBps) || retryBps < 0 || retryBps > 10000) throw Error('Invalid retry allowance');
  const total = items => items.reduce((sum, item) => {
    if (!item.label || !/^(0|[1-9][0-9]*)$/.test(item.units)) throw Error('Exact nonnegative cost required');
    return sum + BigInt(item.units);
  }, 0n);
  const chain = (items, unit) => { const subtotal = total(items), retry = (subtotal * BigInt(retryBps) + 9999n) / 10000n; return { unit, items, subtotal: String(subtotal), retry: String(retry), maximum: String(subtotal + retry) }; };
  return { version: 1, status: 'estimate-not-authorization', base: chain(base, 'wei'), solana: chain(solana, 'lamports'), exclusions: ['token/NFT purchases', 'liquidity', 'permanent locks', 'provider spend', 'deployment'], fundingApproved: false };
}
