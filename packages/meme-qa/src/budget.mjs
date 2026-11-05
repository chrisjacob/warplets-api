/** Exact native units. No token purchase, swap, liquidity or custody permission is implied. */
export function estimateBudget({
  base = [],
  solana = [],
  retryBps = 2500,
  ogMint = null,
  ogDecimals = null,
}) {
  if (
    ogMint !== null &&
    (typeof ogMint !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ogMint))
  )
    throw Error("Invalid OG mint");
  if (
    ogDecimals !== null &&
    (!Number.isSafeInteger(ogDecimals) || ogDecimals < 0 || ogDecimals > 9)
  )
    throw Error("Invalid OG decimals");
  if (!Number.isSafeInteger(retryBps) || retryBps < 0 || retryBps > 10000)
    throw Error("Invalid retry allowance");
  const total = (items) =>
    items.reduce((sum, item) => {
      if (!item.label || !/^(0|[1-9][0-9]*)$/.test(item.units))
        throw Error("Exact nonnegative cost required");
      return sum + BigInt(item.units);
    }, 0n);
  const chain = (items, unit) => {
    const subtotal = total(items),
      retry = (subtotal * BigInt(retryBps) + 9999n) / 10000n;
    return {
      unit,
      items,
      subtotal: String(subtotal),
      retry: String(retry),
      maximum: String(subtotal + retry),
    };
  };
  return {
    version: 1,
    status: "estimate-not-authorization",
    base: chain(base, "wei"),
    solana: chain(solana, "lamports"),
    ogInitialization: {
      mint: ogMint,
      decimals: ogDecimals,
      rawUnits: "1",
      approval: "docs/10x/approvals/2026-10-30-og-minimum.json",
      mintSelectionRequired: ogMint === null,
    },
    exclusions: [
      "token/NFT purchases",
      "liquidity",
      "permanent locks",
      "provider spend",
      "deployment",
    ],
    fundingApproved: false,
  };
}
