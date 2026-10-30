import { PublicKey } from "@solana/web3.js";
import { createHash } from "node:crypto";
// Small project-authored read-back decoder, shared by executable QA only.
export function decodeDistributor(plan, account) {
  if (
    !account ||
    account.owner.toBase58() !== plan.expected.program ||
    account.data.length < 234 ||
    !account.data
      .subarray(0, 8)
      .equals(
        createHash("sha256")
          .update("account:MerkleDistributor")
          .digest()
          .subarray(0, 8),
      )
  )
    throw Error("Wrong distributor owner, discriminator or account length");
  const d = account.data;
  let offset = 9;
  const u64 = () => {
    const v = d.readBigUInt64LE(offset).toString();
    offset += 8;
    return v;
  };
  const key = () => {
    const v = new PublicKey(d.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    return v;
  };
  const version = u64(),
    root = d.subarray(offset, offset + 32).toString("hex");
  offset += 32;
  const mint = key(),
    tokenVault = key(),
    maxTotalClaim = u64(),
    maxNumNodes = u64();
  u64();
  u64();
  const startVestingAt = Number(u64()),
    endVestingAt = Number(u64()),
    clawbackAt = Number(u64()),
    clawbackReceiver = key(),
    admin = key(),
    clawedBack = Boolean(d[offset]);
  return {
    program: account.owner.toBase58(),
    distributor: plan.expected.distributor,
    version,
    root,
    mint,
    tokenVault,
    maxTotalClaim,
    maxNumNodes,
    startVestingAt,
    endVestingAt,
    clawbackAt,
    clawbackReceiver,
    admin,
    clawedBack,
  };
}
