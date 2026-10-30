import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  VersionedMessage,
} from "@solana/web3.js";
import { testDb } from "../../../meme/src/worker/testDb";
import { sha } from "../../../meme/src/worker/db";
import { canonical } from "../../../meme/src/shared/canonical";
import { encode58 } from "../../../meme/src/shared/base58";
import {
  SOLANA_MAINNET_GENESIS,
  type PreparedPacket,
} from "../../../meme/src/shared/packets";
import {
  bindSwapInstructions,
  METEORA_SWAP_PROGRAM,
  type SwapContext,
  type SwapPlan,
} from "../../../meme/src/shared/swapPacket";
import {
  prepareSwap,
  simulateSwap,
  handoffSwap,
  recordSwapSignature,
  reconcileSwap,
  cancelSwap,
  swapId,
  type SwapAdapter,
  type SwapReview,
} from "../../../meme/src/worker/swaps";
const token = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const address = () => Keypair.generate().publicKey.toBase58();
async function fixture(
  key = "fixture-order-1",
  payer = Keypair.generate(),
  network: "solana-local" | "solana-mainnet" = "solana-local",
) {
  const now = Date.now(),
    wallet = payer.publicKey.toBase58(),
    pool = address(),
    og = address(),
    attn = address();
  const q = {
    version: 1 as const,
    network,
    marketId: "m",
    wallet,
    side: "buy-attn" as const,
    inputMint: og,
    outputMint: attn,
    inputAmount: "100",
    expectedOutput: "1000",
    minimumOutput: "990",
    inputDecimals: 9,
    outputDecimals: 9,
    slippageBps: 100,
    quotedAt: now,
    expiresAt: now + 30000,
    contextSlot: 42,
    sourceHash: "a".repeat(64),
    route: "meteora-damm-v2" as const,
    pool,
    fees: {
      networkLamports: "5000",
      accountRentLamports: "0",
      inputFeeUnits: "1",
      inputFeeIncluded: true as const,
      outputFeeUnits: "0",
      outputFeeIncluded: true as const,
    },
  };
  const context: SwapContext = {
    pool,
    tokenAMint: attn,
    tokenBMint: og,
    tokenAVault: address(),
    tokenBVault: address(),
    inputAccount: address(),
    outputAccount: address(),
    eventAuthority: address(),
    sourceHash: q.sourceHash,
    contextSlot: q.contextSlot,
  };
  const accounts = [
    "HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC",
    pool,
    context.inputAccount,
    context.outputAccount,
    context.tokenAVault,
    context.tokenBVault,
    attn,
    og,
    wallet,
    token,
    token,
    METEORA_SWAP_PROGRAM,
    context.eventAuthority,
    METEORA_SWAP_PROGRAM,
  ].map((a, i) => ({
    address: a,
    signer: i === 8,
    writable: [1, 2, 3, 4, 5].includes(i),
  }));
  const bytes = Buffer.alloc(24);
  Buffer.from("f8c69e91e17587c8", "hex").copy(bytes);
  bytes.writeBigUInt64LE(100n, 8);
  bytes.writeBigUInt64LE(990n, 16);
  const plan: SwapPlan = {
    version: 1,
    network,
    operation: "swap",
    subject: key,
    businessKey: `${network}:swap:${wallet}:${key}`,
    signers: [wallet],
    instructions: [
      {
        program: METEORA_SWAP_PROGRAM,
        accounts,
        data: bytes.toString("hex"),
        description: "Exact-in swap",
      },
    ],
    expected: {
      quoteHash: await sha(canonical(q)),
      preconditionHash: context.sourceHash,
    },
    maximumCost: "5000",
    costUnit: "lamports",
    notBefore: now,
    expiresAt: q.expiresAt,
    simulated: network === "solana-local",
  };
  const tx = new Transaction({
      feePayer: payer.publicKey,
      recentBlockhash: address(),
    }).add(
      new TransactionInstruction({
        programId: new PublicKey(METEORA_SWAP_PROGRAM),
        keys: accounts.map((a) => ({
          pubkey: new PublicKey(a.address),
          isSigner: a.signer,
          isWritable: a.writable,
        })),
        data: bytes,
      }),
    ),
    message = tx.serializeMessage(),
    id = await swapId(network, wallet, key),
    planHash = await sha(canonical(plan));
  const packet: PreparedPacket = {
    version: 1,
    network,
    attemptId: id + ":attempt:1",
    planHash,
    genesisHash: SOLANA_MAINNET_GENESIS,
    messageBase64: message.toString("base64"),
    messageHash: await shaBytes(message),
    lifetime: {
      kind: "recent-blockhash",
      blockhash: tx.recentBlockhash!,
      lastValidBlockHeight: 200,
      contextSlot: 42,
      observedAt: now,
    },
    lookupTables: [],
  };
  const review: SwapReview = {
    quote: q,
    context,
    plan,
    packet,
    market: {
      id: "m",
      symbol: "ATTN",
      ogSymbol: "OG",
      ogMint: og,
      attnMint: attn,
      pool,
      launchedAt: 0,
      mode: network === "solana-local" ? "simulated" : "observed",
    },
    risk: {
      maximumSlippageBps: 100,
      maximumNetworkLamports: "5000",
      maximumRentLamports: "0",
      fundingMints: [],
      mintDecimals: { [og]: 9, [attn]: 9 },
    },
  };
  const packetHash = "packet:" + (await sha(canonical(packet))),
    lifetime = () =>
      Promise.resolve({
        packetHash,
        genesisHash: packet.genesisHash,
        blockHeight: 100,
        contextSlot: 42,
        blockhashValid: true,
        observedAt: Date.now(),
        preconditionHash: context.sourceHash,
      });
  const signed = new VersionedTransaction(
    VersionedMessage.deserialize(message),
  );
  signed.sign([payer]);
  const signature = encode58(signed.signatures[0]);
  const adapter: SwapAdapter = {
    async simulate() {
      return {
        packetHash,
        planHash,
        success: true,
        cost: "5000",
        context: "fixture:42",
        expectedHash: await sha(canonical(plan.expected)),
        observedAt: Date.now(),
      };
    },
    async inspect() {
      return {
        network,
        planHash,
        signature,
        expectedHash: await sha(canonical(plan.expected)),
        status: "finalized",
        commitment: "finalized",
        context: "fixture:43",
        complete: true,
        expired: false,
      };
    },
  };
  return { key, payer, id, review, lifetime, signature, adapter };
}
async function shaBytes(bytes: Uint8Array) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString(
    "hex",
  );
}
test("swap binding rejects weakened minima, hidden transfers, foreign accounts and changed signing keys", async () => {
  const f = await fixture(),
    p = f.review.plan,
    q = f.review.quote,
    c = f.review.context;
  bindSwapInstructions(p, q, c);
  for (const mutate of [
    (x: SwapPlan) => x.signers.push(address()),
    (x: SwapPlan) => {
      x.instructions[0].accounts[3].address = address();
    },
    (x: SwapPlan) => {
      x.instructions[0].data =
        x.instructions[0].data.slice(0, 32) + "0100000000000000";
    },
    (x: SwapPlan) => {
      x.instructions.push(structuredClone(x.instructions[0]));
    },
  ]) {
    const changed = structuredClone(p);
    mutate(changed);
    assert.throws(() => bindSwapInstructions(changed, q, c));
  }
});
test("lost responses preserve one swap and receipt; ambiguous submissions block replacement", async () => {
  const t = testDb();
  try {
    const f = await fixture();
    t.interruptNextBatch();
    await assert.rejects(prepareSwap(t.db, f.key, f.review), /lost response/);
    await prepareSwap(t.db, f.key, f.review);
    const other = await fixture("replacement-order", f.payer);
    await assert.rejects(
      prepareSwap(t.db, other.key, other.review),
      /existing swap/,
    );
    await simulateSwap(t.db, f.id, f.adapter);
    const handoffs = await Promise.allSettled([
      handoffSwap(t.db, f.id, f.lifetime),
      handoffSwap(t.db, f.id, f.lifetime),
    ]);
    assert.equal(handoffs.filter((r) => r.status === "fulfilled").length, 1);
    await assert.rejects(
      recordSwapSignature(t.db, f.id, encode58(new Uint8Array(64).fill(3))),
      /Signature/,
    );
    await recordSwapSignature(t.db, f.id, f.signature);
    const unavailable: SwapAdapter = {
      ...f.adapter,
      async inspect() {
        throw Error("RPC down");
      },
    };
    assert.equal(
      (await reconcileSwap(t.db, f.id, unavailable)).state,
      "unknown",
    );
    await assert.rejects(cancelSwap(t.db, f.id), /Reconcile/);
    await assert.rejects(
      prepareSwap(t.db, other.key, other.review),
      /existing swap/,
    );
    t.interruptNextBatch();
    await assert.rejects(reconcileSwap(t.db, f.id, f.adapter), /lost response/);
    assert.equal(
      (await reconcileSwap(t.db, f.id, f.adapter)).state,
      "confirmed",
    );
    assert.equal(
      t.raw.prepare("SELECT count(*) n FROM meme_swap_receipts").get()!.n,
      1,
    );
    assert.throws(
      () => t.raw.exec("DELETE FROM meme_swap_receipts"),
      /Immutable/,
    );
  } finally {
    t.close();
  }
});
test("mainnet handoff is rejected before any reader, and an unsent review can be explicitly cancelled", async () => {
  const t = testDb();
  try {
    const f = await fixture("mainnet-order", undefined, "solana-mainnet");
    await prepareSwap(t.db, f.key, f.review);
    await assert.rejects(
      handoffSwap(t.db, f.id, () => {
        throw Error("Must never read");
      }),
      /Mainnet/,
    );
    await cancelSwap(t.db, f.id);
    assert.equal((await cancelSwap(t.db, f.id)).state, "cancelled");
  } finally {
    t.close();
  }
});
