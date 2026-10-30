import { createHash } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { JITO_COMMIT } from "./distributor.mjs";
import policyProposal from "../policy/jito-locked-v1-proposal.json" with { type: "json" };

export const JITO_PROGRAM = new PublicKey(
  "mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv",
);
const hash = (...parts) =>
  createHash("sha256").update(Buffer.concat(parts)).digest();
const disc = (name) => hash(Buffer.from("global:" + name)).subarray(0, 8);
function u64(value) {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    BigInt(value) > 2n ** 64n - 1n
  )
    throw Error("Exact u64 string required");
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}
function timestamp(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw Error("Exact nonnegative timestamp required");
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(BigInt(value));
  return out;
}
function bytes32(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw Error("32-byte lowercase hex required");
  return Buffer.from(value, "hex");
}
const branch = (a, b) =>
  hash(Buffer.from([1]), ...(Buffer.compare(a, b) <= 0 ? [a, b] : [b, a]));
export function jitoLeaf({ wallet, unlocked, locked }) {
  return hash(
    Buffer.from([0]),
    hash(new PublicKey(wallet).toBuffer(), u64(unlocked), u64(locked)),
  );
}
/** Functional wire-format implementation, checked against pinned upstream vectors.
 * Not a replacement for executing the distributor program. */
export function jitoTree(recipients) {
  if (
    !Array.isArray(recipients) ||
    recipients.length < 1 ||
    recipients.length > 100
  )
    throw Error("Provide 1–100 claimants");
  const wallets = new Set();
  for (const r of recipients) {
    const w = new PublicKey(r.wallet).toBase58();
    if (wallets.has(w)) throw Error("Duplicate claimant");
    wallets.add(w);
  }
  const layers = [recipients.map(jitoLeaf)];
  while (layers.at(-1).length > 1) {
    const prev = layers.at(-1),
      next = [];
    for (let i = 0; i < prev.length; i += 2)
      next.push(branch(prev[i], prev[i + 1] ?? prev[i]));
    layers.push(next);
  }
  return {
    root: layers.at(-1)[0].toString("hex"),
    recipients: recipients.map((r, index) => {
      let cursor = index;
      const proof = [];
      for (const layer of layers.slice(0, -1)) {
        proof.push((layer[cursor ^ 1] ?? layer[cursor]).toString("hex"));
        cursor = Math.floor(cursor / 2);
      }
      return { ...r, proof };
    }),
  };
}
export function verifyJitoProof(recipient, root) {
  if (!Array.isArray(recipient.proof) || recipient.proof.length > 32)
    throw Error("Invalid proof");
  let current = jitoLeaf(recipient);
  for (const sibling of recipient.proof)
    current = branch(current, bytes32(sibling));
  return current.equals(bytes32(root));
}

/** Hypothesis for review. None of these numerical or custody choices is owner-approved yet. */
export const JITO_POLICY_PROPOSAL = Object.freeze(policyProposal);

export function planLockedJito(input) {
  if (input.simulated !== true)
    throw Error("Offline simulated evaluation only");
  if (input.state !== "finalized_unfunded")
    throw Error("Finalized unfunded allocation required");
  if (
    !Number.isSafeInteger(input.launchedAtMs) ||
    input.launchedAtMs <= 0 ||
    input.launchedAtMs > Number.MAX_SAFE_INTEGER - 10 * 86400000 ||
    !Number.isSafeInteger(input.releaseIndex) ||
    input.releaseIndex < 1 ||
    input.releaseIndex > 10
  )
    throw Error("Actual launch time and release 1–10 required");
  if (
    typeof input.allocationId !== "string" ||
    !/^[A-Za-z0-9:._-]{1,200}$/.test(input.allocationId)
  )
    throw Error("Immutable allocation ID required");
  if (!Number.isSafeInteger(input.preparedAt) || input.preparedAt < 0)
    throw Error("Preparation timestamp required");
  bytes32(input.inputHash);
  bytes32(input.resultHash);
  u64(input.version);
  u64(input.expectedAmount);
  const releaseAt = Math.ceil(
    (input.launchedAtMs + input.releaseIndex * 86400000) / 1000,
  );
  timestamp(releaseAt);
  const start = releaseAt,
    end = start + JITO_POLICY_PROPOSAL.vestingSeconds;
  const clawback =
    Math.ceil((input.launchedAtMs + 10 * 86400000) / 1000) +
    1 +
    JITO_POLICY_PROPOSAL.clawbackDaysAfterFinalRelease * 86400;
  timestamp(clawback);
  if (start <= input.preparedAt)
    throw Error(
      "Jito requires distributor creation before vesting starts; late funding needs an explicit recovery plan",
    );
  if (!Array.isArray(input.recipients) || input.recipients.length > 100)
    throw Error("Top-100 recipients required");
  const recipients = input.recipients
    .map((r) => {
      if (r.unlocked != null && r.unlocked !== "0")
        throw Error("Scheduled rewards must be fully locked");
      u64(r.amount);
      return {
        wallet: new PublicKey(r.wallet).toBase58(),
        unlocked: "0",
        locked: r.amount,
      };
    })
    .filter((r) => r.locked !== "0")
    .sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  if (!recipients.length)
    throw Error("No positive entitlements; keep the allocation in reserve");
  const total = recipients.reduce((n, r) => n + BigInt(r.locked), 0n);
  u64(total.toString());
  if (total !== BigInt(input.expectedAmount))
    throw Error("Entitlement total differs from immutable allocation");
  const tree = jitoTree(recipients),
    mint = new PublicKey(input.mint),
    admin = new PublicKey(input.admin),
    receiverOwner = new PublicKey(input.receiverOwner);
  if (!admin.equals(receiverOwner))
    throw Error(
      "Proposal requires the same approved vault for admin and receiver custody",
    );
  const [distributor] = PublicKey.findProgramAddressSync(
    [Buffer.from("MerkleDistributor"), mint.toBuffer(), u64(input.version)],
    JITO_PROGRAM,
  );
  const vault = getAssociatedTokenAddressSync(mint, distributor, true),
    receiver = getAssociatedTokenAddressSync(mint, receiverOwner, true);
  const expected = {
    program: JITO_PROGRAM.toBase58(),
    distributor: distributor.toBase58(),
    version: input.version,
    mint: mint.toBase58(),
    root: tree.root,
    maxTotalClaim: total.toString(),
    maxNumNodes: String(recipients.length),
    startVestingAt: start,
    endVestingAt: end,
    clawbackAt: clawback,
    admin: admin.toBase58(),
    clawbackReceiver: receiver.toBase58(),
    tokenVault: vault.toBase58(),
  };
  const data = Buffer.concat([
    disc("new_distributor"),
    u64(input.version),
    bytes32(tree.root),
    u64(total.toString()),
    u64(String(recipients.length)),
    timestamp(start),
    timestamp(end),
    timestamp(clawback),
  ]);
  const keys = [
    [distributor, false, true],
    [receiver, false, true],
    [mint, false, false],
    [vault, false, true],
    [admin, true, true],
    [SystemProgram.programId, false, false],
    [ASSOCIATED_TOKEN_PROGRAM_ID, false, false],
    [TOKEN_PROGRAM_ID, false, false],
  ].map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable }));
  const creation = new TransactionInstruction({
    programId: JITO_PROGRAM,
    keys,
    data,
  });
  return {
    mode: "offline-unsigned",
    policy: JITO_POLICY_PROPOSAL.id,
    sourceCommit: JITO_COMMIT,
    allocationId: input.allocationId,
    inputHash: input.inputHash,
    resultHash: input.resultHash,
    expected,
    recipients: tree.recipients,
    creation,
    policyApproved: false,
    executionProof: false,
    productionApproved: false,
  };
}

/** Read-back assertion required before any later funding. A failed create must never
 * turn into blindly funding an attacker-created distributor at the same PDA. */
export function assertJitoAccount(plan, observed) {
  for (const [key, value] of Object.entries(plan.expected))
    if (observed?.[key] !== value)
      throw Error("Distributor read-back mismatch: " + key);
  if (observed.clawedBack !== false) throw Error("Distributor is unavailable");
  return true;
}

export function buildLockedClaimInstructions(
  plan,
  wallet,
  claimStatusExists = false,
) {
  if (typeof claimStatusExists !== "boolean")
    throw Error("Observed claim-status existence required");
  if (plan?.mode !== "offline-unsigned" || plan.policyApproved !== false)
    throw Error("Offline evaluation plan required");
  const claimant = new PublicKey(wallet),
    r = plan.recipients.find((r) => r.wallet === claimant.toBase58());
  if (!r || r.unlocked !== "0" || !verifyJitoProof(r, plan.expected.root))
    throw Error("Claimant lacks an accepted fully locked proof");
  const distributor = new PublicKey(plan.expected.distributor),
    mint = new PublicKey(plan.expected.mint),
    vault = new PublicKey(plan.expected.tokenVault),
    to = getAssociatedTokenAddressSync(mint, claimant, true);
  const [status] = PublicKey.findProgramAddressSync(
    [Buffer.from("ClaimStatus"), claimant.toBuffer(), distributor.toBuffer()],
    JITO_PROGRAM,
  );
  const common = [
    [distributor, false, true],
    [status, false, true],
    [vault, false, true],
    [to, false, true],
    [claimant, true, true],
    [TOKEN_PROGRAM_ID, false, false],
  ].map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable }));
  const result = [];
  if (!claimStatusExists) {
    const count = Buffer.alloc(4);
    count.writeUInt32LE(r.proof.length);
    result.push(
      new TransactionInstruction({
        programId: JITO_PROGRAM,
        keys: [
          ...common,
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data: Buffer.concat([
          disc("new_claim"),
          u64("0"),
          u64(r.locked),
          count,
          ...r.proof.map(bytes32),
        ]),
      }),
    );
  }
  result.push(
    new TransactionInstruction({
      programId: JITO_PROGRAM,
      keys: common,
      data: disc("claim_locked"),
    }),
  );
  return result;
}

/** Integer preview of the reviewed vesting formula; chain state remains authoritative. */
export function previewLockedWithdrawal({
  locked,
  withdrawn,
  start,
  end,
  now,
  clawedBack = false,
}) {
  u64(locked);
  u64(withdrawn);
  timestamp(start);
  timestamp(end);
  timestamp(now);
  if (end <= start || BigInt(withdrawn) > BigInt(locked))
    throw Error("Invalid locked claim state");
  if (clawedBack) return "0";
  const vested =
    now < start
      ? 0n
      : now >= end
        ? BigInt(locked)
        : (BigInt(locked) * BigInt(now - start)) / BigInt(end - start);
  if (vested < BigInt(withdrawn))
    throw Error("Claim observation moved backwards");
  return (vested - BigInt(withdrawn)).toString();
}
