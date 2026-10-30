import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  jitoTree,
  verifyJitoProof,
  planLockedJito,
  buildLockedClaimInstructions,
  assertJitoAccount,
  previewLockedWithdrawal,
  JITO_POLICY,
} from "../src/jito-locked.mjs";
const key = (n) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();
const input = () => ({
  simulated: true,
  state: "finalized_unfunded",
  allocationId: "edition:1",
  inputHash: "a".repeat(64),
  resultHash: "b".repeat(64),
  version: "18446744073709551614",
  mint: key(2),
  admin: key(4),
  receiverOwner: key(4),
  launchedAtMs: 1800000000000,
  releaseIndex: 1,
  preparedAt: 1800000100,
  expectedAmount: "100",
  recipients: [
    { wallet: key(7), amount: "60" },
    { wallet: key(8), amount: "40" },
  ],
});

test("approved policy matches the exact reviewed packet while execution remains gated", () => {
  const proposalBytes = readFileSync(
    new URL("../policy/jito-locked-v1-proposal.json", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const proposal = JSON.parse(proposalBytes);
  const record = JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/10x/approvals/2026-10-30-jito-policy.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    createHash("sha256").update(proposalBytes).digest("hex"),
    record.sourceSha256,
  );
  assert.equal(JITO_POLICY.id, record.approvedPolicyId);
  for (const field of [
    "vestingSeconds",
    "clawbackDaysAfterFinalRelease",
    "clawbackTrigger",
    "custody",
    "adminVault",
    "receiverOwner",
    "claimsPause",
    "reserve",
  ])
    assert.deepEqual(JITO_POLICY[field], proposal[field]);
  assert.equal(record.deploymentAuthorized, false);
  assert.equal(record.financialActionsAuthorized, false);
});

test("Merkle roots and every proof match the pinned upstream three-recipient fixture", () => {
  const vector = JSON.parse(
    readFileSync(
      new URL("./fixtures/jito-upstream-vector.json", import.meta.url),
      "utf8",
    ),
  );
  const tree = jitoTree(vector.nodes);
  assert.equal(tree.root, vector.root);
  for (let i = 0; i < vector.nodes.length; i++) {
    assert.deepEqual(tree.recipients[i].proof, vector.nodes[i].proof);
    assert(verifyJitoProof(vector.nodes[i], vector.root));
  }
  assert.equal(
    verifyJitoProof({ ...vector.nodes[0], locked: "1" }, vector.root),
    false,
  );
});
test("fully locked plans preserve allocation totals, u64 version, stable roots and ten actual-launch release times", () => {
  const a = planLockedJito(input()),
    b = planLockedJito({
      ...input(),
      recipients: [...input().recipients].reverse(),
    });
  assert.equal(a.expected.root, b.expected.root);
  assert.deepEqual(a.creation.data, b.creation.data);
  assert.equal(
    a.creation.data.subarray(0, 8).toString("hex"),
    "208b70ab0002e19b",
  );
  assert.equal(a.creation.data.readBigUInt64LE(8), 18446744073709551614n);
  assert.equal(a.creation.data.length, 88);
  const abi = JSON.parse(
    readFileSync(
      new URL("./fixtures/jito-wire-interface.json", import.meta.url),
      "utf8",
    ),
  ).instructions.find((i) => i.name === "newDistributor");
  const accounts = {
    distributor: a.expected.distributor,
    clawbackReceiver: a.expected.clawbackReceiver,
    mint: a.expected.mint,
    tokenVault: a.expected.tokenVault,
    admin: a.expected.admin,
    systemProgram: SystemProgram.programId.toBase58(),
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
  };
  assert.equal(abi.args[0].type, "u64");
  abi.accounts.forEach((account, i) => {
    assert.equal(a.creation.keys[i].pubkey.toBase58(), accounts[account.name]);
    assert.equal(a.creation.keys[i].isSigner, account.isSigner);
    assert.equal(a.creation.keys[i].isWritable, account.isMut);
  });
  assert(a.recipients.every((r) => r.unlocked === "0"));
  assert.equal(a.expected.startVestingAt, 1800086400);
  assert.equal(a.expected.endVestingAt, 1800086401);
  const last = planLockedJito({ ...input(), releaseIndex: 10 });
  assert.equal(last.expected.startVestingAt, 1800864000);
  assert.equal(last.expected.clawbackAt, a.expected.clawbackAt);
  assert.equal(JITO_POLICY.status, "approved");
  assert.equal(a.policyApproved, true);
  assert.equal(a.productionApproved, false);
  assert.equal(a.executionProof, false);
});
test("time rounding never unlocks before the actual millisecond release and repeated withdrawals have zero remainder", () => {
  const p = planLockedJito({ ...input(), launchedAtMs: 1800000000123 });
  assert.equal(p.expected.startVestingAt, 1800086401);
  const state = {
    locked: "18446744073709551615",
    withdrawn: "0",
    start: p.expected.startVestingAt,
    end: p.expected.endVestingAt,
  };
  assert.equal(
    previewLockedWithdrawal({ ...state, now: state.start - 1 }),
    "0",
  );
  assert.equal(previewLockedWithdrawal({ ...state, now: state.start }), "0");
  assert.equal(
    previewLockedWithdrawal({ ...state, now: state.end }),
    state.locked,
  );
  assert.equal(
    previewLockedWithdrawal({
      ...state,
      withdrawn: state.locked,
      now: state.end,
    }),
    "0",
  );
  assert.equal(
    previewLockedWithdrawal({ ...state, now: state.end, clawedBack: true }),
    "0",
  );
  assert.equal(
    previewLockedWithdrawal({
      locked: "101",
      withdrawn: "0",
      start: 100,
      end: 200,
      now: 125,
    }),
    "25",
  );
});
test("unsafe allocations, unlocked rewards, duplicate wallets, incomplete custody and late creation fail closed", () => {
  for (const change of [
    { simulated: false },
    { state: "provisional" },
    { releaseIndex: 0 },
    { launchedAtMs: Number.MAX_SAFE_INTEGER },
    { expectedAmount: "99" },
    { version: "18446744073709551616" },
    { preparedAt: 1800086400 },
    { admin: key(5) },
    { recipients: [] },
    { recipients: [{ wallet: key(7), amount: "100", unlocked: "1" }] },
    {
      recipients: [
        { wallet: key(7), amount: "50" },
        { wallet: key(7), amount: "50" },
      ],
    },
  ])
    assert.throws(() => planLockedJito({ ...input(), ...change }));
});
test("read-back rejects front-run distributor accounts and altered authorities before any later funding", () => {
  const p = planLockedJito(input()),
    observed = { ...p.expected, clawedBack: false };
  assert.equal(assertJitoAccount(p, observed), true);
  for (const change of [
    { admin: key(5) },
    { root: "c".repeat(64) },
    { clawbackReceiver: key(6) },
    { clawbackAt: 1 },
    { mint: key(9) },
    { program: key(10) },
    { clawedBack: true },
  ])
    assert.throws(() => assertJitoAccount(p, { ...observed, ...change }));
});
test("claim instructions encode zero unlocked tokens and reuse the frozen claim-status PDA on retries", () => {
  const p = planLockedJito(input()),
    wallet = p.recipients[0].wallet,
    first = buildLockedClaimInstructions(p, wallet),
    retry = buildLockedClaimInstructions(p, wallet, true);
  assert.equal(first.length, 2);
  assert.equal(retry.length, 1);
  assert.equal(
    first[0].data.subarray(0, 8).toString("hex"),
    "4eb1627bd215bb53",
  );
  assert.equal(first[0].data.readBigUInt64LE(8), 0n);
  assert.equal(first[1].data.toString("hex"), "22ceb5170bcf935a");
  assert(first[1].keys[1].pubkey.equals(retry[0].keys[1].pubkey));
  assert.throws(() => buildLockedClaimInstructions(p, key(20)), /proof/);
  assert.throws(
    () => buildLockedClaimInstructions({ ...p, mode: "production" }, wallet),
    /Offline/,
  );
  assert.throws(
    () =>
      buildLockedClaimInstructions({ ...p, productionApproved: true }, wallet),
    /Offline/,
  );
});
test("a top-100 claim proof and initialize/withdraw pair fit one unsigned Solana transaction", () => {
  const recipients = Array.from({ length: 100 }, (_, i) => ({
    wallet: key(i + 1),
    amount: "1",
  }));
  const p = planLockedJito({ ...input(), recipients }),
    wallet = p.recipients[0].wallet;
  const tx = new Transaction({
    feePayer: new PublicKey(wallet),
    recentBlockhash: key(0),
  }).add(...buildLockedClaimInstructions(p, wallet));
  const size = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).length;
  assert(
    size <= 1232,
    `Unsigned claim packet ${size} exceeds the Solana packet limit`,
  );
});
