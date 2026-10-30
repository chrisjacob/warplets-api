import test from "node:test";
import assert from "node:assert/strict";
import { testDb } from "./testDb";
import { sha } from "./db";
import { canonical } from "../shared/canonical";
import { encode58 } from "../shared/base58";
import { runClaimBatch } from "./claimBatch";
import type {
  TransactionPlan,
  TransactionReadAdapter,
} from "../shared/transactions";
import {
  prepareIntent,
  simulateIntent,
  beginHandoff,
  recordSignature,
  reconcileIntent,
  getIntent,
  retryFailedIntent,
  renewIntentAttempt,
} from "./transactions";
const wallet = "11111111111111111111111111111111",
  signature = encode58(new Uint8Array(64).fill(2));
function plan(subject = "allocation:1"): TransactionPlan {
  return {
    version: 1,
    network: "solana-local",
    operation: "claim",
    subject,
    businessKey: "solana-local:claim:" + subject,
    signers: [wallet],
    instructions: [
      {
        program: wallet,
        accounts: [{ address: wallet, signer: true, writable: true }],
        data: "0102",
        description: "Local fixture only",
      },
    ],
    expected: { amount: "100", wallet },
    maximumCost: "2000000",
    costUnit: "lamports",
    notBefore: Date.now() - 1,
    expiresAt: Date.now() + 120000,
    simulated: true,
  };
}
function adapter(
  p: TransactionPlan,
  change: Partial<TransactionReadAdapter> = {},
): TransactionReadAdapter {
  return {
    simulate: async (_, h) => ({
      planHash: h,
      success: true,
      cost: "5000",
      context: "local-slot:1",
      expectedHash: await sha(canonical(p.expected)),
      observedAt: Date.now(),
    }),
    inspect: async (_, h, s) => ({
      status: "finalized",
      network: p.network,
      planHash: h,
      signature: s,
      expectedHash: await sha(canonical(p.expected)),
      context: "local-slot:2",
      expired: false,
      complete: true,
    }),
    ...change,
  };
}
test("lost response after durable preparation preserves one immutable business operation", async () => {
  const t = testDb();
  try {
    const p = plan();
    t.interruptNextBatch();
    await assert.rejects(prepareIntent(t.db, p), /lost response/);
    const i = await prepareIntent(t.db, p);
    assert.equal((await prepareIntent(t.db, p)).id, i.id);
    await assert.rejects(
      prepareIntent(t.db, { ...p, maximumCost: "1" }),
      /different immutable/,
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_transaction_intents").get()!.n,
      1,
    );
  } finally {
    t.close();
  }
});
test("concurrent wallet handoffs have a single winner and ambiguity blocks all repeats", async () => {
  const t = testDb();
  try {
    const p = plan(),
      i = await prepareIntent(t.db, p),
      a = adapter(p);
    await simulateIntent(t.db, i.id, a);
    const attempts = await Promise.allSettled([
      beginHandoff(t.db, i.id),
      beginHandoff(t.db, i.id),
    ]);
    assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
    await assert.rejects(beginHandoff(t.db, i.id));
    assert.equal((await getIntent(t.db, i.id)).state, "unknown");
  } finally {
    t.close();
  }
});
test("confirmed claims are idempotent, append-only and cannot be confirmed by unrelated evidence", async () => {
  const t = testDb();
  try {
    const p = plan(),
      i = await prepareIntent(t.db, p),
      a = adapter(p);
    await simulateIntent(t.db, i.id, a);
    await beginHandoff(t.db, i.id);
    await recordSignature(t.db, i.id, signature);
    await assert.rejects(
      reconcileIntent(
        t.db,
        i.id,
        adapter(p, {
          inspect: async () => ({
            status: "finalized",
            network: "base-mainnet",
            planHash: "changed",
            signature,
            expectedHash: "wrong",
            context: "fake",
            expired: false,
            complete: true,
          }),
        }),
      ),
      /does not match/,
    );
    assert.equal((await reconcileIntent(t.db, i.id, a)).state, "confirmed");
    assert.equal((await reconcileIntent(t.db, i.id, a)).state, "confirmed");
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_financial_receipts").get()!.n,
      1,
    );
    assert.throws(
      () =>
        t.raw.exec(
          "UPDATE meme_financial_receipts SET evidence_hash='changed'",
        ),
      /immutable/,
    );
  } finally {
    t.close();
  }
});
test("unreleased claims and mainnet packets cannot reach a signing handoff", async () => {
  const t = testDb();
  try {
    const p = { ...plan(), notBefore: Date.now() + 30000 };
    const i = await prepareIntent(t.db, p);
    await simulateIntent(t.db, i.id, adapter(p));
    await assert.rejects(beginHandoff(t.db, i.id), /not released/);
    const m = {
      ...plan("mainnet"),
      network: "solana-mainnet" as const,
      businessKey: "solana-mainnet:claim:mainnet",
      simulated: false,
    };
    const mi = await prepareIntent(t.db, m);
    await simulateIntent(t.db, mi.id, adapter(m));
    await assert.rejects(beginHandoff(t.db, mi.id), /Mainnet/);
  } finally {
    t.close();
  }
});
test("simulation exceeding the budget and incomplete absence cannot authorize a retry", async () => {
  const t = testDb();
  try {
    const p = plan(),
      i = await prepareIntent(t.db, p);
    await assert.rejects(
      simulateIntent(
        t.db,
        i.id,
        adapter(p, {
          simulate: async (_, h) => ({
            planHash: h,
            success: true,
            cost: "2000001",
            context: "local",
            expectedHash: await sha(canonical(p.expected)),
            observedAt: Date.now(),
          }),
        }),
      ),
      /ceiling/,
    );
    await simulateIntent(t.db, i.id, adapter(p));
    await beginHandoff(t.db, i.id);
    const a = adapter(p, {
      inspect: async (_, h) => ({
        status: "absent",
        network: p.network,
        planHash: h,
        signature: null,
        expectedHash: await sha(canonical(p.expected)),
        context: "local",
        expired: true,
        complete: false,
      }),
    });
    assert.equal((await reconcileIntent(t.db, i.id, a)).state, "unknown");
  } finally {
    t.close();
  }
});
test("only a completely reconciled chain failure permits an explicit retry", async () => {
  const t = testDb();
  try {
    const p = plan(),
      i = await prepareIntent(t.db, p),
      a = adapter(p);
    await simulateIntent(t.db, i.id, a);
    await beginHandoff(t.db, i.id);
    await assert.rejects(retryFailedIntent(t.db, i.id), /Reconcile/);
    await recordSignature(t.db, i.id, signature);
    const failed = adapter(p, {
      inspect: async (_, h, s) => ({
        status: "failed",
        network: p.network,
        planHash: h,
        signature: s,
        expectedHash: await sha(canonical(p.expected)),
        context: "local-failed-slot",
        expired: false,
        complete: true,
      }),
    });
    assert.equal((await reconcileIntent(t.db, i.id, failed)).state, "failed");
    assert.equal((await retryFailedIntent(t.db, i.id)).state, "prepared");
    await simulateIntent(t.db, i.id, a);
    await beginHandoff(t.db, i.id);
    const retrySignature = encode58(new Uint8Array(64).fill(3));
    await recordSignature(t.db, i.id, retrySignature);
    assert.equal((await reconcileIntent(t.db, i.id, a)).state, "confirmed");
    await assert.rejects(retryFailedIntent(t.db, i.id), /Reconcile/);
    assert.throws(
      () => t.raw.exec("DELETE FROM meme_transaction_events"),
      /immutable/,
    );
  } finally {
    t.close();
  }
});
test("claim-all preserves partial success and reconciles a lost submission without calling the wallet twice", async () => {
  const t = testDb();
  try {
    const p1 = plan("release:1"),
      p2 = plan("release:2"),
      i1 = await prepareIntent(t.db, p1),
      i2 = await prepareIntent(t.db, p2);
    let submissions = 0,
      pending = true;
    const a: TransactionReadAdapter = {
      simulate: async (p, h) => adapter(p).simulate(p, h),
      inspect: async (p, h, s) =>
        pending && p.subject === "release:2"
          ? {
              status: "pending",
              network: p.network,
              planHash: h,
              signature: s,
              expectedHash: await sha(canonical(p.expected)),
              context: "local-pending",
              complete: false,
              expired: false,
            }
          : adapter(p).inspect(p, h, s),
    };
    const first = await runClaimBatch(t.db, [i1.id, i2.id], a, async (p) => {
      submissions++;
      if (p.subject === "release:2") throw Error("Lost wallet response");
      return signature;
    });
    assert.deepEqual(
      first.results.map((r) => r.state),
      ["confirmed", "unknown"],
    );
    assert.equal(first.nextCursor, 1);
    assert.equal(submissions, 2);
    await runClaimBatch(
      t.db,
      [i1.id, i2.id],
      a,
      async () => {
        throw Error("Must never resubmit");
      },
      1,
    );
    assert.equal(submissions, 2);
    const observed = encode58(new Uint8Array(64).fill(4));
    await recordSignature(t.db, i2.id, observed);
    pending = false;
    const resumed = await runClaimBatch(
      t.db,
      [i1.id, i2.id],
      a,
      async () => {
        throw Error("Must never resubmit");
      },
      1,
    );
    assert.equal(resumed.complete, true);
    assert.equal(resumed.allClaimed, true);
    assert.equal(resumed.results[0].state, "confirmed");
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_financial_receipts").get()!.n,
      2,
    );
  } finally {
    t.close();
  }
});

test("expiry renewal and stale resimulation append attempts under one immutable operation; lost responses are idempotent", async (context) => {
  const t = testDb(),
    now = Date.now();
  context.mock.timers.enable({ apis: ["Date"], now });
  try {
    const p = plan(),
      i = await prepareIntent(t.db, p);
    await simulateIntent(t.db, i.id, adapter(p));
    context.mock.timers.setTime(now + 130000);
    await assert.rejects(beginHandoff(t.db, i.id), /expired/);
    const renewed = { ...p, expiresAt: Date.now() + 120000 },
      review = {
        key: "expiry-renewal-01",
        reason: "Reviewed local expiry renewal without changing business terms",
      };
    t.interruptNextBatch();
    await assert.rejects(
      renewIntentAttempt(t.db, i.id, renewed, review),
      /lost response/,
    );
    const recovered = await renewIntentAttempt(t.db, i.id, renewed, review);
    assert.equal(recovered.id, i.id);
    assert.equal(recovered.attempt, 1);
    assert.equal(recovered.simulation, null);
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_transaction_intents").get()!.n,
      1,
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_transaction_attempts").get()!
        .n,
      2,
    );
    assert.equal(
      t.raw.prepare("SELECT plan_hash FROM meme_transaction_intents").get()!
        .plan_hash,
      i.plan_hash,
    );
    assert.notEqual(recovered.plan_hash, i.plan_hash);
    await assert.rejects(
      renewIntentAttempt(
        t.db,
        i.id,
        { ...renewed, maximumCost: "9999999" },
        {
          key: "change-cost-denied",
          reason: "Changes cannot hide inside a retry",
        },
      ),
      /immutable business/,
    );
    await simulateIntent(t.db, i.id, adapter(renewed));
    await beginHandoff(t.db, i.id);
    const approval = t.raw
      .prepare("SELECT * FROM meme_transaction_approvals")
      .get()!;
    assert.equal(approval.attempt_id, recovered.attempt_id);
    assert.equal(approval.authority, "local-test-controller");
    await assert.rejects(
      renewIntentAttempt(t.db, i.id, renewed, {
        key: "ambiguous-denied",
        reason: "Must not replace an ambiguous operation",
      }),
      /Reconcile ambiguous/,
    );
    assert.throws(
      () =>
        t.raw
          .prepare("UPDATE meme_transaction_attempts SET reason='changed'")
          .run(),
      /immutable/,
    );
    assert.throws(
      () => t.raw.prepare("DELETE FROM meme_transaction_approvals").run(),
      /immutable/,
    );
  } finally {
    context.mock.timers.reset();
    t.close();
  }
});

test("confirmed is provisional until finalized; a reorg/pending result never creates a financial receipt", async () => {
  const t = testDb();
  try {
    const p = plan(),
      i = await prepareIntent(t.db, p),
      a = adapter(p);
    await simulateIntent(t.db, i.id, a);
    await beginHandoff(t.db, i.id);
    await recordSignature(t.db, i.id, signature);
    let status: "confirmed" | "pending" | "finalized" = "confirmed";
    const observing = adapter(p, {
      inspect: async (p, h, s) => ({
        ...(await a.inspect(p, h, s)),
        status,
        complete: status === "finalized",
      }),
    });
    const observed = await reconcileIntent(t.db, i.id, observing);
    assert.equal(observed.state, "submitted");
    assert.equal(observed.chain_status, "confirmed");
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_financial_receipts").get()!.n,
      0,
    );
    status = "pending";
    assert.equal(
      (await reconcileIntent(t.db, i.id, observing)).chain_status,
      "pending",
    );
    status = "finalized";
    const final = await reconcileIntent(t.db, i.id, observing);
    assert.equal(final.state, "confirmed");
    assert.equal(final.chain_status, "finalized");
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_financial_receipts").get()!.n,
      1,
    );
  } finally {
    t.close();
  }
});

test("funding requires a freshly re-read committed configuration before a handoff reservation", async () => {
  const t = testDb();
  try {
    const p = {
      ...plan("fund:1"),
      operation: "fund" as const,
      businessKey: "solana-local:fund:fund:1",
    };
    await assert.rejects(prepareIntent(t.db, p), /configuration precondition/);
    p.expected.preconditionHash = "a".repeat(64);
    const i = await prepareIntent(t.db, p);
    await simulateIntent(t.db, i.id, adapter(p));
    await assert.rejects(beginHandoff(t.db, i.id), /Re-read distributor/);
    await assert.rejects(
      beginHandoff(t.db, i.id, async () => ({
        planHash: i.plan_hash,
        observedHash: "b".repeat(64),
        observedAt: Date.now(),
        context: "local:1",
      })),
      /changed or are stale/,
    );
    assert.equal((await getIntent(t.db, i.id)).state, "awaiting_approval");
    await beginHandoff(t.db, i.id, async () => ({
      planHash: i.plan_hash,
      observedHash: p.expected.preconditionHash,
      observedAt: Date.now(),
      context: "local:1",
    }));
    assert.equal((await getIntent(t.db, i.id)).state, "unknown");
  } finally {
    t.close();
  }
});
