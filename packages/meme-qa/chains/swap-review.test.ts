import test from "node:test";
import assert from "node:assert/strict";
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  Transaction,
} from "@solana/web3.js";
import { getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { testDb } from "../../../meme/src/worker/testDb";
import { sha } from "../../../meme/src/worker/db";
import { canonical } from "../../../meme/src/shared/canonical";
import {
  bindSwapInstructions,
  type SwapPlan,
  type SwapContext,
} from "../../../meme/src/shared/swapPacket";
import type { SwapQuote, SwapRisk } from "../../../meme/src/shared/swapQuote";
import {
  swapId,
  prepareSwap,
  simulateSwap,
  handoffSwap,
  recordSwapSignature,
  reconcileSwap,
  cancelSwap,
  type SwapAdapter,
} from "../../../meme/src/worker/swaps";
import {
  startSolana,
  chainTime,
  sendFixtureInstructions,
  createLocalMint,
  createLocalAta,
  mintLocal,
  instructionsForPlan,
  prepareLocalPacket,
  localReadAdapter,
  sendLocalPlan,
} from "../src/local-solana.mjs";
import { inspectPacketLifetime } from "../src/packet-lifetime.mjs";
import { existingSwapInstructions } from "../src/swap-accounts.mjs";
import {
  buildLaunchProof,
  CpAmm,
  BN,
} from "../../meme-protocol/src/meteora.mjs";
import { fixture } from "../../meme-protocol/src/fixture.mjs";
test(
  "actual local swaps bind SDK quotes, exact messages, signatures and one durable receipt",
  {
    skip: process.platform !== "linux" || process.arch !== "x64",
    timeout: 120000,
  },
  async () => {
    const { net, connection, payer } = await startSolana(),
      t = testDb();
    try {
      const mint = await createLocalMint(connection, payer, 9),
        og = await createLocalMint(connection, payer, 9),
        attnAta = await createLocalAta(
          connection,
          payer,
          mint,
          payer.publicKey,
        ),
        ogAta = await createLocalAta(connection, payer, og, payer.publicKey),
        nft = Keypair.generate();
      await mintLocal(connection, payer, mint, attnAta.address, 1000000000000n);
      await mintLocal(connection, payer, og, ogAta.address, 1000000001n);
      const initial = await chainTime(connection),
        proof = await buildLaunchProof({
          ...fixture,
          totalSupply: "1000000000000",
          editionMint: mint.toBase58(),
          ogMint: og.toBase58(),
          creator: payer.publicKey.toBase58(),
          payer: payer.publicKey.toBase58(),
          positionNft: nft.publicKey.toBase58(),
          activationUnixSeconds: Math.floor(initial / 1000) + 1,
        });
      await sendFixtureInstructions(
        connection,
        payer,
        proof.instructions.map(
          (i) =>
            new TransactionInstruction({
              programId: new PublicKey(i.program),
              keys: i.accounts.map((k) => ({
                pubkey: new PublicKey(k.pubkey),
                isSigner: k.signer,
                isWritable: k.writable,
              })),
              data: Buffer.from(i.data, "hex"),
            }),
        ),
        [nft],
      );
      net.timeTravelToTimestamp(initial + 61000);
      const amm = new CpAmm(connection),
        pool = new PublicKey(proof.pool),
        market = {
          id: "local-swap",
          symbol: "ATTN",
          ogSymbol: "OG",
          ogMint: og.toBase58(),
          attnMint: mint.toBase58(),
          pool: proof.pool,
          launchedAt: Date.now() - 1000,
          mode: "simulated" as const,
        };
      for (const [number, input, output, inputAccount, outputAccount, side] of [
        [1, og, mint, ogAta.address, attnAta.address, "buy-attn"],
        [2, mint, og, attnAta.address, ogAta.address, "sell-attn"],
      ] as const) {
        const ps = await amm.fetchPoolState(pool),
          info = await connection.getAccountInfoAndContext(pool, {
            commitment: "finalized",
          }),
          contextHash = await sha(
            Buffer.from(info.value!.data).toString("base64"),
          ),
          block = await connection.getSlot("finalized"),
          amount = "1000000",
          time = Math.floor((await chainTime(connection)) / 1000);
        const quote = amm.getQuote({
          inAmount: new BN(amount),
          inputTokenMint: input,
          slippage: 1,
          poolState: ps,
          currentTime: time,
          currentSlot: block,
          tokenADecimal: 9,
          tokenBDecimal: 9,
        });
        const expected = quote.swapOutAmount.toString(),
          minimum = ((BigInt(expected) * 99n) / 100n).toString(),
          quotedAt = Date.now();
        assert(BigInt(minimum) > 0n);
        const q: SwapQuote = {
          version: 1,
          network: "solana-local",
          marketId: market.id,
          wallet: payer.publicKey.toBase58(),
          side,
          inputMint: input.toBase58(),
          outputMint: output.toBase58(),
          inputAmount: amount,
          expectedOutput: expected,
          minimumOutput: minimum,
          inputDecimals: 9,
          outputDecimals: 9,
          slippageBps: 100,
          quotedAt,
          expiresAt: quotedAt + 30000,
          contextSlot: info.context.slot,
          sourceHash: contextHash,
          route: "meteora-damm-v2",
          pool: proof.pool,
          fees: {
            networkLamports: "10000",
            accountRentLamports: "0",
            inputFeeUnits:
              side === "buy-attn" ? quote.totalFee.toString() : "0",
            inputFeeIncluded: true,
            outputFeeUnits:
              side === "sell-attn" ? quote.totalFee.toString() : "0",
            outputFeeIncluded: true,
          },
        };
        const transaction = await amm.swap({
          payer: payer.publicKey,
          pool,
          inputTokenMint: input,
          outputTokenMint: output,
          amountIn: new BN(amount),
          minimumAmountOut: new BN(minimum),
          tokenAMint: mint,
          tokenBMint: og,
          tokenAVault: ps.tokenAVault,
          tokenBVault: ps.tokenBVault,
          tokenAProgram: TOKEN_PROGRAM_ID,
          tokenBProgram: TOKEN_PROGRAM_ID,
          referralTokenAccount: null,
          poolState: ps,
        });
        const swap = transaction.instructions.find(
          (i) => i.programId.toBase58() === proof.program,
        )!;
        const context: SwapContext = {
          pool: proof.pool,
          tokenAMint: mint.toBase58(),
          tokenBMint: og.toBase58(),
          tokenAVault: ps.tokenAVault.toBase58(),
          tokenBVault: ps.tokenBVault.toBase58(),
          inputAccount: inputAccount.toBase58(),
          outputAccount: outputAccount.toBase58(),
          eventAuthority: swap.keys[12].pubkey.toBase58(),
          sourceHash: contextHash,
          contextSlot: info.context.slot,
        };
        const key = "local-swap-" + number,
          id = await swapId(q.network, q.wallet, key),
          plan: SwapPlan = {
            version: 1,
            network: q.network,
            operation: "swap",
            subject: key,
            businessKey: `${q.network}:swap:${q.wallet}:${key}`,
            signers: [q.wallet],
            instructions: instructionsForPlan(
              await existingSwapInstructions(
                connection,
                transaction.instructions,
                payer.publicKey,
                input,
                output,
                info.context.slot,
              ),
            ),
            expected: {
              quoteHash: await sha(canonical(q)),
              preconditionHash: contextHash,
              inputAmount: amount,
              minimumOutput: minimum,
            },
            maximumCost: q.fees.networkLamports,
            costUnit: "lamports",
            notBefore: quotedAt,
            expiresAt: q.expiresAt,
            simulated: true,
          };
        bindSwapInstructions(plan, q, context);
        const weaker = structuredClone(plan);
        weaker.instructions.at(-1)!.data =
          weaker.instructions.at(-1)!.data.slice(0, 32) + "0100000000000000";
        assert.throws(() => bindSwapInstructions(weaker, q, context));
        const risk: SwapRisk = {
            maximumSlippageBps: 100,
            maximumNetworkLamports: "10000",
            maximumRentLamports: "0",
            fundingMints: [],
            mintDecimals: { [q.inputMint]: 9, [q.outputMint]: 9 },
          },
          packet = await prepareLocalPacket(
            connection,
            plan,
            id + ":attempt:1",
            await sha(canonical(plan)),
          ),
          review = { quote: q, risk, market, context, plan, packet },
          packetRef = {
            id: "packet:" + (await sha(canonical(packet))),
            packet,
          };
        t.interruptNextBatch();
        await assert.rejects(prepareSwap(t.db, key, review), /lost response/);
        await prepareSwap(t.db, key, review);
        const beforeInput = await getAccount(connection, inputAccount),
          beforeOutput = await getAccount(connection, outputAccount);
        const adapter = localReadAdapter(
          connection,
          async () => {
            const a = await getAccount(connection, inputAccount, "finalized"),
              b = await getAccount(connection, outputAccount, "finalized");
            assert.equal(beforeInput.amount - a.amount, BigInt(amount));
            assert(b.amount - beforeOutput.amount >= BigInt(minimum));
            assert(a.owner.equals(payer.publicKey));
            assert(b.owner.equals(payer.publicKey));
            return plan.expected;
          },
          packetRef,
        ) as SwapAdapter;
        await simulateSwap(t.db, id, adapter);
        await handoffSwap(t.db, id, async () => ({
          ...(await inspectPacketLifetime(
            connection.rpcEndpoint,
            packetRef.id,
            packet,
          )),
          preconditionHash: await sha(
            (await connection.getAccountInfo(pool, "finalized"))!.data.toString(
              "base64",
            ),
          ),
        }));
        await assert.rejects(cancelSwap(t.db, id), /Reconcile/);
        const signature = await sendLocalPlan(
          connection,
          plan,
          [payer],
          packetRef,
        );
        t.interruptNextBatch();
        await assert.rejects(
          recordSwapSignature(t.db, id, signature),
          /lost response/,
        );
        await recordSwapSignature(t.db, id, signature);
        const result = await reconcileSwap(t.db, id, adapter);
        assert.equal(result.state, "confirmed");
        await reconcileSwap(t.db, id, adapter);
        assert.equal(
          t.raw.prepare("SELECT count(*) n FROM meme_swap_receipts").get()!.n,
          number,
        );
      }
    } finally {
      t.close();
      net.stop();
    }
  },
);
