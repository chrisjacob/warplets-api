import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
  SystemProgram,
} from "@solana/web3.js";
import {
  bytesHash,
  decodeMessage,
  validatePacket,
  SOLANA_MAINNET_GENESIS,
  type PreparedPacket,
} from "../../../meme/src/shared/packets";
import { encode58 } from "../../../meme/src/shared/base58";
import { canonical } from "../../../meme/src/shared/canonical";
import type {
  TransactionPlan,
  TransactionReadAdapter,
} from "../../../meme/src/shared/transactions";
import { testDb } from "../../../meme/src/worker/testDb";
import { sha } from "../../../meme/src/worker/db";
import {
  prepareIntent,
  simulateIntent,
  beginHandoff,
  recordSignature,
  getIntent,
  reconcileIntent,
} from "../../../meme/src/worker/transactions";
import { attachPacket, activePacket } from "../../../meme/src/worker/packets";
import { inspectPacketLifetime } from "../src/packet-lifetime.mjs";
import { localInspector } from "../src/local-solana-read.mjs";

async function fixture(v0: boolean) {
  const payer = Keypair.generate(),
    to = Keypair.generate().publicKey,
    blockhash = Keypair.generate().publicKey.toBase58();
  const ix = SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: to,
    lamports: 1000,
  });
  const lookup = new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      deactivationSlot: 2n ** 64n - 1n,
      lastExtendedSlot: 1,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: [to],
    },
  });
  const legacy = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: blockhash,
  }).add(ix);
  const message = v0
    ? new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message([lookup])
    : legacy.compileMessage();
  const plan: TransactionPlan = {
    version: 1,
    network: "solana-local",
    operation: "claim",
    subject: "packet-fixture",
    businessKey: "solana-local:claim:packet-fixture",
    signers: [payer.publicKey.toBase58()],
    instructions: [
      {
        program: ix.programId.toBase58(),
        accounts: ix.keys.map((k) => ({
          address: k.pubkey.toBase58(),
          signer: k.isSigner,
          writable: k.isWritable,
        })),
        data: ix.data.toString("hex"),
        description: "Local fixture transfer",
      },
    ],
    expected: { amount: "1000", wallet: to.toBase58() },
    maximumCost: "10000",
    costUnit: "lamports",
    notBefore: Date.now() - 1,
    expiresAt: Date.now() + 120000,
    simulated: true,
  };
  const bytes = message.serialize(),
    packet: PreparedPacket = {
      version: 1,
      network: "solana-local",
      attemptId: "fixture",
      planHash: await sha(canonical(plan)),
      genesisHash: encode58(new Uint8Array(32).fill(9)),
      messageBase64: Buffer.from(bytes).toString("base64"),
      messageHash: await bytesHash(bytes),
      lifetime: {
        kind: "recent-blockhash",
        blockhash,
        lastValidBlockHeight: 100,
        contextSlot: 42,
        observedAt: Date.now(),
      },
      lookupTables: v0
        ? [
            {
              address: lookup.key.toBase58(),
              contextSlot: 42,
              dataHash: "b".repeat(64),
              addresses: [to.toBase58()],
            },
          ]
        : [],
    };
  const signed = new VersionedTransaction(message);
  signed.sign([payer]);
  return { payer, plan, packet, signed };
}
for (const v0 of [false, true])
  test(
    (v0 ? "v0 lookup" : "legacy") +
      " packets match the actual Solana compiler and reject altered effects",
    async () => {
      const f = await fixture(v0);
      const decoded = await validatePacket(
        f.plan,
        "fixture",
        f.packet.planHash,
        f.packet,
      );
      assert.equal(decoded.version, v0 ? 0 : "legacy");
      assert.equal(decoded.instructions[0].data, f.plan.instructions[0].data);
      const altered = structuredClone(f.packet);
      altered.messageHash = "f".repeat(64);
      await assert.rejects(
        validatePacket(f.plan, "fixture", f.packet.planHash, altered),
        /hash mismatch/,
      );
      await assert.rejects(
        validatePacket(
          {
            ...f.plan,
            instructions: [{ ...f.plan.instructions[0], data: "00" }],
          },
          "fixture",
          f.packet.planHash,
          f.packet,
        ),
        /instruction differs/,
      );
      const wrong = structuredClone(f.packet);
      wrong.lifetime.blockhash = Keypair.generate().publicKey.toBase58();
      await assert.rejects(
        validatePacket(f.plan, "fixture", f.packet.planHash, wrong),
        /lifetime/,
      );
      await assert.rejects(
        validatePacket(
          { ...f.plan, network: "solana-mainnet" },
          "fixture",
          f.packet.planHash,
          { ...f.packet, network: "solana-mainnet" },
        ),
        /genesis/,
      );
      if (v0) {
        const missing = structuredClone(f.packet);
        missing.lookupTables = [];
        await assert.rejects(
          validatePacket(f.plan, "fixture", f.packet.planHash, missing),
          /lookup/,
        );
        const changed = structuredClone(f.packet);
        changed.lookupTables[0].addresses = [
          Keypair.generate().publicKey.toBase58(),
        ];
        await assert.rejects(
          validatePacket(f.plan, "fixture", f.packet.planHash, changed),
          /unapproved accounts/,
        );
      }
      assert.throws(
        () => decodeMessage(Uint8Array.from([129, 1, 0, 0])),
        /Unsupported/,
      );
      assert.throws(
        () => decodeMessage(Uint8Array.from([1, 0, 0, 128, 0])),
        /Noncanonical/,
      );
      const nonce = SystemProgram.nonceAdvance({
        noncePubkey: Keypair.generate().publicKey,
        authorizedPubkey: f.payer.publicKey,
      });
      const message = new TransactionMessage({
        payerKey: f.payer.publicKey,
        recentBlockhash: f.packet.lifetime.blockhash,
        instructions: [nonce],
      }).compileToLegacyMessage();
      assert.throws(() => decodeMessage(message.serialize()), /Durable nonce/);
      const result = {
        slot: 42,
        meta: { err: null, fee: 5000 },
        transaction: [
          Buffer.from(f.signed.serialize()).toString("base64"),
          "base64",
        ],
      };
      const inspect = localInspector(
        { rpcEndpoint: "http://127.0.0.1:8899" },
        async () => f.plan.expected,
        async (_url: string, method: string) =>
          method === "getTransaction"
            ? result
            : {
                context: { slot: 43 },
                value: [
                  { slot: 42, err: null, confirmationStatus: "finalized" },
                ],
              },
        f.packet,
      );
      const observed = await inspect(
        f.plan,
        f.packet.planHash,
        encode58(f.signed.signatures[0]),
      );
      assert.equal(observed.status, "finalized");
    },
  );
test("packet attachment, simulation binding and fresh lifetime preserve one real signed handoff", async () => {
  const f = await fixture(true),
    t = testDb();
  try {
    const intent = await prepareIntent(t.db, f.plan);
    f.packet.attemptId = intent.attempt_id;
    t.interruptNextBatch();
    await assert.rejects(
      attachPacket(t.db, intent.id, f.packet),
      /lost response/,
    );
    assert.equal(
      (await attachPacket(t.db, intent.id, f.packet)).replayed,
      true,
    );
    const stored = (await activePacket(t.db, intent.attempt_id))!;
    const base: TransactionReadAdapter = {
      simulate: async (_, planHash) => ({
        planHash,
        success: true,
        cost: "5000",
        context: "fixture:42",
        expectedHash: await sha(canonical(f.plan.expected)),
        observedAt: Date.now(),
      }),
      inspect: async (_, planHash, signature) => ({
        network: "solana-local",
        planHash,
        signature,
        expectedHash: await sha(canonical(f.plan.expected)),
        status: "finalized",
        commitment: "finalized",
        complete: true,
        expired: false,
        context: "fixture:45",
      }),
    };
    await assert.rejects(
      simulateIntent(t.db, intent.id, base),
      /bind the active/,
    );
    const adapter = {
      ...base,
      simulate: async (p: TransactionPlan, h: string) => ({
        ...(await base.simulate(p, h)),
        packetHash: stored.id,
      }),
    };
    await simulateIntent(t.db, intent.id, adapter);
    await assert.rejects(
      beginHandoff(t.db, intent.id),
      /Re-read the packet lifetime/,
    );
    const fresh = async () => ({
      packetHash: stored.id,
      genesisHash: f.packet.genesisHash,
      contextSlot: 43,
      blockHeight: 90,
      blockhashValid: true,
      observedAt: Date.now(),
    });
    await assert.rejects(
      beginHandoff(t.db, intent.id, undefined, async () => ({
        ...(await fresh()),
        blockHeight: 101,
      })),
      /lifetime expired/,
    );
    await beginHandoff(t.db, intent.id, undefined, fresh);
    await assert.rejects(
      recordSignature(t.db, intent.id, encode58(new Uint8Array(64).fill(2))),
      /does not authorize/,
    );
    await recordSignature(t.db, intent.id, encode58(f.signed.signatures[0]));
    await assert.rejects(
      attachPacket(t.db, intent.id, {
        ...f.packet,
        lifetime: { ...f.packet.lifetime, observedAt: Date.now() + 1 },
      }),
      /Reconcile/,
    );
    assert.equal(
      (await reconcileIntent(t.db, intent.id, adapter)).state,
      "confirmed",
    );
    assert.equal(
      t.raw.prepare("SELECT COUNT(*) n FROM meme_financial_receipts").get()!.n,
      1,
    );
    assert.throws(
      () => t.raw.exec("DELETE FROM meme_transaction_packet_heads"),
      /cannot be deleted/,
    );
  } finally {
    t.close();
  }
});
test("lifetime reads bind genesis and block context but never claim a complete absence search", async () => {
  const { packet } = await fixture(false),
    calls: string[] = [];
  const result = await inspectPacketLifetime(
    "http://127.0.0.1:8899",
    "packet:fixture",
    packet,
    async (_url: string, method: string, params: unknown) => {
      calls.push(method);
      if (method === "getGenesisHash") return SOLANA_MAINNET_GENESIS;
      if (method === "getBlockHeight") return 101;
      assert.equal(method, "isBlockhashValid");
      return { context: { slot: 43 }, value: false };
    },
  );
  assert.deepEqual(calls, [
    "getGenesisHash",
    "getBlockHeight",
    "isBlockhashValid",
  ]);
  assert.equal(result.blockhashValid, false);
  assert.equal(result.completeIntentSearch, false);
});
