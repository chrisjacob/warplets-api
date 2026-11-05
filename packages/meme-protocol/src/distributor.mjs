export const JITO_COMMIT = "2cf79f63973a79e6354871dc9355a63aa1d15139";
/** Evidence-based suitability check, not a distributor implementation or on-chain proof. */
export function evaluateJito({
  amountUnlocked,
  releaseAt,
  startVestingAt,
  endVestingAt,
  clawbackAt,
  requireNoExpiry,
}) {
  const gaps = [];
  if (BigInt(amountUnlocked) !== 0n)
    gaps.push(
      "new_claim transfers unlocked tokens without enforcing start_ts; scheduled rewards must have zero unlocked amount",
    );
  if (startVestingAt < releaseAt)
    gaps.push("Locked vesting begins before the required release");
  if (endVestingAt <= startVestingAt)
    gaps.push("The program requires start_ts < end_ts");
  if (clawbackAt < endVestingAt + 86400)
    gaps.push(
      "The program requires clawback at least one day after vesting ends",
    );
  if (requireNoExpiry)
    gaps.push(
      "Mandatory clawback timestamp and mutable admin/receiver need an approved custody and no-expiry policy",
    );
  return {
    candidate: "jito-distributor",
    commit: JITO_COMMIT,
    license: "GPL-3.0",
    clawbackPermissionless: true,
    onChainClaimsPause: false,
    supported: gaps.length === 0,
    gaps,
    productionApproved: false,
    executionProof: false,
  };
}
