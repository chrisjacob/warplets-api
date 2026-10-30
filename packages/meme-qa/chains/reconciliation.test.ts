import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { localInspector } from "../src/local-solana-read.mjs";
import { encode58 } from "../../../meme/src/shared/base58";
import { canonical } from "../../../meme/src/shared/canonical";
import { sha } from "../../../meme/src/worker/db";
import { testDb } from "../../../meme/src/worker/testDb";
import {
  prepareIntent,
  simulateIntent,
  beginHandoff,
  recordSignature,
  reconcileIntent,
  getIntent,
  retryFailedIntent,
} from "../../../meme/src/worker/transactions";
import type {
  TransactionPlan,
  TransactionReadAdapter,
} from "../../../meme/src/shared/transactions";

const endpoint = "http://127.0.0.1:19999"; // Injected transport: never listens or calls a provider.
function fixture() {
  const payer = Keypair.generate(),
    recipient = Keypair.generate().publicKey;
  const instruction = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: recipient,
    lamports: 1,
  });
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(instruction);
  tx.sign(payer);
  const signature = encode58(tx.signature!);
  const plan: TransactionPlan = {
    version: 1,
    network: "solana-local",
    operation: "claim",
    subject: "fixture:1",
    businessKey: "solana-local:claim:fixture:1",
    signers: [payer.publicKey.toBase58()],
    instructions: [
      {
        program: instruction.programId.toBase58(),
        accounts: instruction.keys.map((a) => ({
          address: a.pubkey.toBase58(),
          signer: a.isSigner,
          writable: a.isWritable,
        })),
        data: instruction.data.toString("hex"),
        description: "Disposable local transfer",
      },
    ],
    expected: { wallet: recipient.toBase58(), amount: "1" },
    maximumCost: "10000",
    costUnit: "lamports",
    notBefore: Date.now() - 1,
    expiresAt: Date.now() + 60000,
    simulated: true,
  };
  const result = {
    slot: 42,
    transaction: [tx.serialize().toString("base64"), "base64"],
    meta: { err: null as null | object, fee: 5000 },
  };
  const statuses = {
    context: { slot: 44 },
    value: [
      { slot: 42, err: null as null | object, confirmationStatus: "finalized" },
    ],
  };
  return { payer, tx, signature, plan, result, statuses };
}
function harness(f: ReturnType<typeof fixture>) {
  let initial: unknown = f.result,
    finalized: unknown = f.result,
    status: unknown = f.statuses;
  let failure = "",
    reads: unknown = f.plan.expected;
  const calls: string[] = [],
    accountReads: unknown[] = [];
  const inspect = localInspector(
    { rpcEndpoint: endpoint },
    async (plan: TransactionPlan, options: unknown) => {
      assert.equal(plan, f.plan);
      accountReads.push(options);
      if (failure === "accounts") throw Error("RPC unavailable");
      return reads;
    },
    async (url: string, method: string, params: any[]) => {
      assert.equal(url, endpoint);
      if (failure === method) throw Error("RPC unavailable");
      if (method === "getTransaction") {
        assert.equal(params[0], f.signature);
        assert.equal(params[1].encoding, "base64");
        assert.equal(params[1].maxSupportedTransactionVersion, 0);
        calls.push(params[1].commitment);
        return structuredClone(
          params[1].commitment === "finalized" ? finalized : initial,
        );
      }
      assert.equal(method, "getSignatureStatuses");
      assert.deepEqual(params, [
        [f.signature],
        { searchTransactionHistory: true },
      ]);
      calls.push("status");
      return structuredClone(status);
    },
  );
  return {
    inspect,
    calls,
    accountReads,
    setInitial: (v: unknown) => (initial = v),
    setFinalized: (v: unknown) => (finalized = v),
    setStatuses: (v: unknown) => (status = v),
    setFailure: (v: string) => (failure = v),
    setAccounts: (v: unknown) => (reads = v),
  };
}

test("finality binds the exact signature, finalized wire body and finalized account context", async () => {
  const f = fixture(),
    h = harness(f);
  const observed = await h.inspect(f.plan, "plan-hash", f.signature);
  assert.equal(observed.status, "finalized");
  assert.equal(observed.commitment, "finalized");
  assert.equal(observed.complete, true);
  assert.equal(observed.expectedHash, await sha(canonical(f.plan.expected)));
  assert.deepEqual(h.calls, ["confirmed", "status", "finalized"]);
  assert.deepEqual(h.accountReads, [
    { commitment: "finalized", minContextSlot: 42 },
  ]);
});

test("another valid signature for identical instructions cannot impersonate the requested transaction", async () => {
  const f = fixture(),
    h = harness(f);
  f.tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
  f.tx.sign(f.payer);
  h.setInitial({
    ...f.result,
    transaction: [f.tx.serialize().toString("base64"), "base64"],
  });
  await assert.rejects(
    h.inspect(f.plan, "hash", f.signature),
    /requested signature/,
  );
  assert.equal(h.accountReads.length, 0);
});

test("wire mismatch, malformed encoding, unapproved signers, excessive fees and unsafe slots fail closed", async () => {
  const f = fixture();
  for (const bad of [
    { ...f.result, meta: { err: null, fee: 10001 } },
    { ...f.result, meta: { err: null, fee: NaN } },
    { ...f.result, meta: { fee: 5000 } },
    { ...f.result, slot: Number.MAX_SAFE_INTEGER + 1 },
    { ...f.result, transaction: [f.result.transaction[0], "json"] },
    { ...f.result, transaction: [f.result.transaction[0] + "!", "base64"] },
    {
      ...f.result,
      transaction: [
        Buffer.concat([f.tx.serialize(), Buffer.from([0])]).toString("base64"),
        "base64",
      ],
    },
  ]) {
    const h = harness(f);
    h.setInitial(bad);
    await assert.rejects(h.inspect(f.plan, "hash", f.signature));
    assert.equal(h.accountReads.length, 0);
  }
  const h = harness(f);
  await assert.rejects(
    h.inspect(
      {
        ...f.plan,
        signers: [...f.plan.signers, Keypair.generate().publicKey.toBase58()],
      },
      "hash",
      f.signature,
    ),
    /approved plan/,
  );
  await assert.rejects(
    h.inspect(
      { ...f.plan, instructions: [{ ...f.plan.instructions[0], data: "00" }] },
      "hash",
      f.signature,
    ),
    /instruction mismatch/,
  );
  await assert.rejects(
    h.inspect(
      {
        ...f.plan,
        instructions: [f.plan.instructions[0], f.plan.instructions[0]],
      },
      "hash",
      f.signature,
    ),
    /approved plan/,
  );
  const changed = structuredClone(f.plan);
  changed.instructions[0].accounts[1].writable = false;
  await assert.rejects(
    h.inspect(changed, "hash", f.signature),
    /instruction mismatch/,
  );
});

test("conflicting status/error/slot evidence and changed finalized bodies never produce receipts", async () => {
  const f = fixture();
  for (const bad of [
    { context: { slot: 44 }, value: [{ ...f.statuses.value[0], slot: 43 }] },
    { context: { slot: 41 }, value: f.statuses.value },
    {
      context: { slot: 44 },
      value: [
        { ...f.statuses.value[0], err: { InstructionError: [0, "Custom"] } },
      ],
    },
    {
      context: { slot: 44 },
      value: [{ ...f.statuses.value[0], confirmationStatus: "unknown" }],
    },
    { context: { slot: 44 }, value: [] },
  ]) {
    const h = harness(f);
    h.setStatuses(bad);
    await assert.rejects(h.inspect(f.plan, "hash", f.signature));
    assert.equal(h.accountReads.length, 0);
  }
  for (const bad of [
    { ...f.result, slot: 43 },
    {
      ...f.result,
      meta: { err: { InstructionError: [0, "Custom"] }, fee: 5000 },
    },
    { ...f.result, meta: { err: null, fee: 5001 } },
  ]) {
    const h = harness(f);
    h.setFinalized(bad);
    await assert.rejects(h.inspect(f.plan, "hash", f.signature));
    assert.equal(h.accountReads.length, 0);
  }
});

test("null RPC results, missing signature and elapsed wall time never establish absence", async () => {
  const f = fixture();
  f.plan.expiresAt = Date.now() - 1;
  const missing = harness(f);
  const absent = await missing.inspect(f.plan, "hash", null);
  assert.equal(absent.complete, false);
  assert.equal(absent.expired, false);
  assert.deepEqual(missing.calls, []);
  for (const kind of ["initial", "status", "finalized"]) {
    const h = harness(f);
    if (kind === "initial") h.setInitial(null);
    if (kind === "status")
      h.setStatuses({ context: { slot: 44 }, value: [null] });
    if (kind === "finalized") h.setFinalized(null);
    const observed = await h.inspect(f.plan, "hash", f.signature);
    assert.equal(observed.status, "pending");
    assert.equal(observed.complete, false);
    assert.equal(observed.expired, false);
    assert.equal(h.accountReads.length, 0);
  }
});

test("a confirmed error remains pending until matching finalized failure evidence exists", async () => {
  const f = fixture(),
    h = harness(f),
    err = { InstructionError: [0, { Custom: 6000 }] };
  h.setInitial({ ...f.result, meta: { err, fee: 5000 } });
  h.setStatuses({
    context: { slot: 44 },
    value: [{ ...f.statuses.value[0], err, confirmationStatus: "confirmed" }],
  });
  assert.equal(
    (await h.inspect(f.plan, "hash", f.signature)).status,
    "pending",
  );
  h.setStatuses({
    context: { slot: 44 },
    value: [{ ...f.statuses.value[0], err }],
  });
  h.setFinalized({ ...f.result, meta: { err, fee: 5000 } });
  const observed = await h.inspect(f.plan, "hash", f.signature);
  assert.equal(observed.status, "failed");
  assert.equal(observed.commitment, "finalized");
  assert.equal(observed.complete, true);
  assert.equal(h.accountReads.length, 0);
});

test("RPC and expected-state read errors remain unresolved; mainnet and remote endpoints are rejected before any call", async () => {
  const f = fixture();
  for (const method of ["getTransaction", "getSignatureStatuses", "accounts"]) {
    const h = harness(f);
    h.setFailure(method);
    await assert.rejects(
      h.inspect(f.plan, "hash", f.signature),
      /RPC unavailable/,
    );
  }
  const h = harness(f);
  h.setAccounts({ ...f.plan.expected, amount: "2" });
  await assert.rejects(h.inspect(f.plan, "hash", f.signature), /account state/);
  await assert.rejects(
    h.inspect(
      { ...f.plan, network: "solana-mainnet", simulated: false },
      "hash",
      f.signature,
    ),
    /mainnet/,
  );
  const remote = localInspector(
    { rpcEndpoint: "https://api.mainnet-beta.solana.com" },
    () => {
      throw Error("Must not read");
    },
    () => {
      throw Error("Must not call");
    },
  );
  await assert.rejects(remote(f.plan, "hash", f.signature), /Local simulator/);
});

test("durable controller survives confirmation loss and RPC outage without retrying or duplicating a financial receipt", async () => {
  const f = fixture(),
    t = testDb();
  let mode = "confirmed";
  const inspect = localInspector(
    { rpcEndpoint: endpoint },
    async (p: TransactionPlan) => p.expected,
    async (_url: string, method: string) => {
      if (mode === "outage") throw Error("RPC unavailable");
      if (method === "getTransaction")
        return mode === "missing" ? null : structuredClone(f.result);
      return {
        ...f.statuses,
        value: [
          {
            ...f.statuses.value[0],
            confirmationStatus:
              mode === "confirmed" ? "confirmed" : "finalized",
          },
        ],
      };
    },
  );
  const adapter: TransactionReadAdapter = {
    simulate: async (p, planHash) => ({
      planHash,
      success: true,
      cost: "5000",
      context: "fixture:42",
      expectedHash: await sha(canonical(p.expected)),
      observedAt: Date.now(),
    }),
    inspect: inspect as TransactionReadAdapter["inspect"],
  };
  try {
    const i = await prepareIntent(t.db, f.plan);
    await simulateIntent(t.db, i.id, adapter);
    await beginHandoff(t.db, i.id);
    await recordSignature(t.db, i.id, f.signature);
    assert.equal(
      (await reconcileIntent(t.db, i.id, adapter)).chain_status,
      "confirmed",
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_financial_receipts").get()!.n,
      0,
    );
    mode = "missing";
    assert.equal(
      (await reconcileIntent(t.db, i.id, adapter)).chain_status,
      "pending",
    );
    await assert.rejects(retryFailedIntent(t.db, i.id), /Reconcile/);
    mode = "outage";
    await assert.rejects(
      reconcileIntent(t.db, i.id, adapter),
      /RPC unavailable/,
    );
    assert.equal((await getIntent(t.db, i.id)).state, "submitted");
    mode = "finalized";
    const results = await Promise.all([
      reconcileIntent(t.db, i.id, adapter),
      reconcileIntent(t.db, i.id, adapter),
    ]);
    assert(results.every((r) => r.state === "confirmed"));
    await reconcileIntent(t.db, i.id, adapter);
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_financial_receipts").get()!.n,
      1,
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_transaction_attempts").get()!
        .n,
      1,
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_transaction_approvals").get()!
        .n,
      1,
    );
  } finally {
    t.close();
  }
});
