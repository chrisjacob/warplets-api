import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SYSVAR_CLOCK_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  getMint,
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  AuthorityType,
} from "@solana/spl-token";
import { installPrograms } from "../src/programs.mjs";
import { loopback } from "../src/safety.mjs";
import {
  planLockedJito,
  buildLockedClaimInstructions,
  assertJitoAccount,
  JITO_PROGRAM,
} from "../../meme-protocol/src/jito-locked.mjs";
import {
  buildLaunchProof,
  CpAmm,
  BN,
  cpAmmCoder,
} from "../../meme-protocol/src/meteora.mjs";
import { fixture } from "../../meme-protocol/src/fixture.mjs";
import {
  createLocalMint,
  createLocalAta,
  mintLocal,
} from "../src/local-solana.mjs";
const supported = process.platform === "linux" && process.arch === "x64";
const disc = (name) =>
  createHash("sha256")
    .update("global:" + name)
    .digest()
    .subarray(0, 8);
async function runtime() {
  const { Surfnet } = await import("@solana/surfpool");
  const net = Surfnet.startWithConfig({
    offline: true,
    blockProductionMode: "transaction",
  });
  loopback(net.rpcUrl);
  installPrograms(net);
  const connection = new Connection(net.rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: net.wsUrl,
  });
  const payer = Keypair.fromSecretKey(net.payerSecretKey);
  return { net, connection, payer };
}
async function send(connection, payer, instructions, signers = []) {
  loopback(connection.rpcEndpoint);
  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer.publicKey, ...block }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
    ...instructions,
  );
  tx.sign(payer, ...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 0,
  });
  const deadline=performance.now()+10000;
  for(;;){
    const result=await connection.getSignatureStatus(sig,{searchTransactionHistory:true});
    if(result.value){assert.equal(result.value.err,null);if(result.value.confirmationStatus==="finalized")break;}
    if(performance.now()>=deadline)throw Error("Local signature finality not yet observed; transaction was not resent");
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  return sig;
}
async function clock(connection) {
  const a = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  return Number(a.data.readBigInt64LE(32));
}
function decodeDistributor(plan, a) {
  assert(a?.owner.equals(JITO_PROGRAM));
  const d = a.data;
  let o = 8;
  const u8 = () => d[o++],
    u64 = () => {
      const v = d.readBigUInt64LE(o).toString();
      o += 8;
      return v;
    },
    key = () => {
      const v = new PublicKey(d.subarray(o, o + 32)).toBase58();
      o += 32;
      return v;
    };
  u8();
  const version = u64(),
    root = d.subarray(o, o + 32).toString("hex");
  o += 32;
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
    clawedBack = !!u8();
  return {
    program: a.owner.toBase58(),
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

test(
  "Meteora rejects unfunded OG; approved one-unit minimum executes pool creation, lock and swaps",
  { skip: !supported, timeout: 120000 },
  async () => {
    const { net, connection, payer } = await runtime();
    try {
      const mint = await createMint(
          connection,
          payer,
          payer.publicKey,
          null,
          9,
        ),
        og = await createMint(connection, payer, payer.publicKey, null, 9);
      const ata = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        payer.publicKey,
      );
      await mintTo(connection, payer, mint, ata.address, payer, 1000000000000n);
      const nft = Keypair.generate(),
        now = await clock(connection);
      const proof = await buildLaunchProof({
        ...fixture,
        totalSupply: "1000000000000",
        editionMint: mint.toBase58(),
        ogMint: og.toBase58(),
        creator: payer.publicKey.toBase58(),
        payer: payer.publicKey.toBase58(),
        positionNft: nft.publicKey.toBase58(),
        activationUnixSeconds: now + 60,
      });
      const instructions = proof.instructions.map(
        (i) =>
          new TransactionInstruction({
            programId: new PublicKey(i.program),
            keys: i.accounts.map((a) => ({
              pubkey: new PublicKey(a.pubkey),
              isSigner: a.signer,
              isWritable: a.writable,
            })),
            data: Buffer.from(i.data, "hex"),
          }),
      );
      await assert.rejects(
        send(connection, payer, instructions, [nft]),
        /insufficient funds/,
      );
      assert.equal(
        await connection.getAccountInfo(new PublicKey(proof.pool)),
        null,
      );
      const quoteAta = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        og,
        payer.publicKey,
      );
      await send(connection, payer, [
        createMintToInstruction(og, quoteAta.address, payer.publicKey, 1n),
      ]);
      // Approved on 30 October: exactly one raw OG unit, recorded separately from gas/rent.
      await send(connection, payer, instructions, [nft]);
      const pool = await connection.getAccountInfo(new PublicKey(proof.pool));
      assert(pool?.owner.equals(new PublicKey(proof.program)));
      const position = await connection.getAccountInfo(
        new PublicKey(proof.position),
      );
      assert(position?.owner.equals(new PublicKey(proof.program)));
      const state = cpAmmCoder.accounts.decode("Position", position.data);
      assert.equal(
        state.permanent_locked_liquidity.toString(),
        proof.liquidityDelta,
      );
      assert.equal(state.unlocked_liquidity.toString(), "0");
      const amm = new CpAmm(connection),
        ps = await amm.fetchPoolState(new PublicKey(proof.pool));
      assert.equal(ps.tokenAMint.toBase58(), mint.toBase58());
      assert.equal(ps.tokenBMint.toBase58(), og.toBase58());
      assert.equal(ps.collectFeeMode, 1);
      assert.equal((await getAccount(connection, ps.tokenBVault)).amount, 1n);
      await send(connection, payer, [
        createMintToInstruction(
          og,
          quoteAta.address,
          payer.publicKey,
          1000000000n,
        ),
      ]);
      const swap = (input, output, amount) =>
        amm.swap({
          payer: payer.publicKey,
          pool: new PublicKey(proof.pool),
          inputTokenMint: input,
          outputTokenMint: output,
          amountIn: new BN(amount),
          minimumAmountOut: new BN(1),
          tokenAMint: mint,
          tokenBMint: og,
          tokenAVault: ps.tokenAVault,
          tokenBVault: ps.tokenBVault,
          tokenAProgram: TOKEN_PROGRAM_ID,
          tokenBProgram: TOKEN_PROGRAM_ID,
          referralTokenAccount: null,
          poolState: ps,
        });
      await assert.rejects(
        send(connection, payer, (await swap(og, mint, "1000000")).instructions),
        /./,
      );
      net.timeTravelToTimestamp((now + 61) * 1000);
      const beforeA = (await getAccount(connection, ata.address)).amount;
      await send(
        connection,
        payer,
        (await swap(og, mint, "1000000")).instructions,
      );
      assert((await getAccount(connection, ata.address)).amount > beforeA);
      await send(
        connection,
        payer,
        (await swap(mint, og, "1000000")).instructions,
      );
      assert.equal((await getMint(connection, mint)).supply, 1000000000000n);
      await send(connection, payer, [
        createSetAuthorityInstruction(
          mint,
          payer.publicKey,
          AuthorityType.MintTokens,
          null,
        ),
      ]);
      assert.equal((await getMint(connection, mint)).mintAuthority, null);
    } finally {
      net.stop();
    }
  },
);
test(
  "Jito underfunding, authority changes and permissionless clawback preserve the accepted allocation",
  { skip: !supported, timeout: 120000 },
  async () => {
    const { net, connection, payer } = await runtime();
    try {
      const claimant = Keypair.generate(),
        replacement = Keypair.generate();
      net.fundSol(claimant.publicKey.toBase58(), 10000000000);
      net.fundSol(replacement.publicKey.toBase58(), 10000000000);
      const mint = await createLocalMint(connection, payer, 0),
        source = await createLocalAta(connection, payer, mint, payer.publicKey),
        to = await createLocalAta(connection, payer, mint, claimant.publicKey),
        alternative = await createLocalAta(
          connection,
          payer,
          mint,
          replacement.publicKey,
        );
      await mintLocal(connection, payer, mint, source.address, 300n);
      const now = await clock(connection),
        plan = planLockedJito({
          simulated: true,
          state: "finalized_unfunded",
          allocationId: "qa:recovery",
          inputHash: "a".repeat(64),
          resultHash: "b".repeat(64),
          version: "5000",
          mint: mint.toBase58(),
          admin: payer.publicKey.toBase58(),
          receiverOwner: payer.publicKey.toBase58(),
          launchedAtMs: (now + 10) * 1000,
          releaseIndex: 1,
          preparedAt: now,
          expectedAmount: "300",
          recipients: [
            { wallet: claimant.publicKey.toBase58(), amount: "100" },
            { wallet: replacement.publicKey.toBase58(), amount: "200" },
          ],
        });
      await send(connection, payer, [plan.creation]);
      const distributor = new PublicKey(plan.expected.distributor),
        vault = new PublicKey(plan.expected.tokenVault);
      const observe = async () =>
        decodeDistributor(plan, await connection.getAccountInfo(distributor));
      assertJitoAccount(plan, await observe());
      const setAdmin = (admin, next) =>
        new TransactionInstruction({
          programId: JITO_PROGRAM,
          keys: [
            { pubkey: distributor, isSigner: false, isWritable: true },
            { pubkey: admin, isSigner: true, isWritable: true },
            { pubkey: next, isSigner: false, isWritable: true },
          ],
          data: disc("set_admin"),
        });
      await assert.rejects(
        send(connection, claimant, [
          setAdmin(claimant.publicKey, replacement.publicKey),
        ]),
        /./,
      );
      await send(connection, payer, [
        setAdmin(payer.publicKey, replacement.publicKey),
      ]);
      await assert.rejects(
        async () => assertJitoAccount(plan, await observe()),
        /admin/,
      );
      await send(connection, replacement, [
        setAdmin(replacement.publicKey, payer.publicKey),
      ]);
      assertJitoAccount(plan, await observe());
      const setReceiver = (address) =>
        new TransactionInstruction({
          programId: JITO_PROGRAM,
          keys: [
            { pubkey: distributor, isSigner: false, isWritable: true },
            { pubkey: address, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          ],
          data: disc("set_clawback_receiver"),
        });
      await send(connection, payer, [setReceiver(alternative.address)]);
      await assert.rejects(
        async () => assertJitoAccount(plan, await observe()),
        /clawbackReceiver/,
      );
      await send(connection, payer, [setReceiver(source.address)]);
      assertJitoAccount(plan, await observe());
      await send(connection, payer, [
        createTransferInstruction(source.address, vault, payer.publicKey, 50n),
      ]);
      net.timeTravelToTimestamp((plan.expected.endVestingAt + 1) * 1000);
      const instructions = buildLockedClaimInstructions(
        plan,
        claimant.publicKey.toBase58(),
      );
      await assert.rejects(send(connection, claimant, instructions), /./);
      assert.equal((await getAccount(connection, to.address)).amount, 0n);
      assert.equal((await getAccount(connection, vault)).amount, 50n);
      await send(connection, payer, [
        createTransferInstruction(source.address, vault, payer.publicKey, 250n),
      ]);
      const wrong = instructions.map(
        (ix) =>
          new TransactionInstruction({ ...ix, data: Buffer.from(ix.data) }),
      );
      wrong[0].data.writeBigUInt64LE(101n, 16);
      await assert.rejects(send(connection, claimant, wrong), /./);
      await send(connection, claimant, instructions);
      assert.equal((await getAccount(connection, to.address)).amount, 100n);
      assert.equal((await getAccount(connection, vault)).amount, 200n);
      const clawback = new TransactionInstruction({
        programId: JITO_PROGRAM,
        keys: [
          { pubkey: distributor, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: true },
          { pubkey: source.address, isSigner: false, isWritable: true },
          { pubkey: claimant.publicKey, isSigner: true, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: disc("clawback"),
      });
      net.timeTravelToTimestamp((plan.expected.clawbackAt - 1) * 1000);
      await assert.rejects(send(connection, claimant, [clawback]), /./);
      net.timeTravelToTimestamp((plan.expected.clawbackAt + 1) * 1000);
      await send(connection, claimant, [clawback]);
      assert.equal((await getAccount(connection, source.address)).amount, 200n);
      assert.equal((await getAccount(connection, vault)).amount, 0n);
      assert.equal((await observe()).clawedBack, true);
    } finally {
      net.stop();
    }
  },
);

test(
  "captured Jito binary enforces ten overlapping campaigns, all release boundaries and duplicate-claim recovery",
  { skip: !supported, timeout: 240000 },
  async () => {
    const { net, connection, payer } = await runtime();
    try {
      const claimant = Keypair.generate();
      net.fundSol(claimant.publicKey.toBase58(), 10000000000);
      const mint = await createMint(
          connection,
          payer,
          payer.publicKey,
          null,
          0,
        ),
        source = await getOrCreateAssociatedTokenAccount(
          connection,
          payer,
          mint,
          payer.publicKey,
        ),
        destination = await getOrCreateAssociatedTokenAccount(
          connection,
          payer,
          mint,
          claimant.publicKey,
        );
      await mintTo(connection, payer, mint, source.address, payer, 10000n);
      const initial = await clock(connection),
        launchedAt = (initial + 10) * 1000,
        plans = [];
      // 100 real distributors. Test-only payer custody does not certify production multisig custody.
      for (let campaign = 0; campaign < 10; campaign++)
        for (let release = 1; release <= 10; release++) {
          const plan = planLockedJito({
            simulated: true,
            state: "finalized_unfunded",
            allocationId: `qa:${campaign}:${release}`,
            inputHash: "a".repeat(64),
            resultHash: "b".repeat(64),
            version: String(campaign * 10 + release),
            mint: mint.toBase58(),
            admin: payer.publicKey.toBase58(),
            receiverOwner: payer.publicKey.toBase58(),
            launchedAtMs: launchedAt + campaign * 86400000,
            releaseIndex: release,
            preparedAt: initial,
            expectedAmount: "100",
            recipients: [
              { wallet: claimant.publicKey.toBase58(), amount: "100" },
            ],
          });
          await send(connection, payer, [plan.creation]);
          assertJitoAccount(
            plan,
            decodeDistributor(
              plan,
              await connection.getAccountInfo(
                new PublicKey(plan.expected.distributor),
              ),
            ),
          );
          await send(connection, payer, [
            createTransferInstruction(
              source.address,
              new PublicKey(plan.expected.tokenVault),
              payer.publicKey,
              100n,
            ),
          ]);
          plans.push(plan);
        }
      let claimed = 0n;
      const grouped = new Map();
      for (const p of plans.sort(
        (a, b) => a.expected.startVestingAt - b.expected.startVestingAt,
      )) {
        const list = grouped.get(p.expected.startVestingAt) ?? [];
        list.push(p);
        grouped.set(p.expected.startVestingAt, list);
      }
      for (const [start, group] of grouped) {
        net.timeTravelToTimestamp(start * 1000 - 1000);
        for (const plan of group) {
          const before = (await getAccount(connection, destination.address))
            .amount;
          try {
            await send(
              connection,
              claimant,
              buildLockedClaimInstructions(plan, claimant.publicKey.toBase58()),
            );
          } catch {
            /* A zero withdrawal may be rejected; either outcome must pay zero. */
          }
          assert.equal(
            (await getAccount(connection, destination.address)).amount,
            before,
          );
        }
        net.timeTravelToTimestamp((start + 2) * 1000);
        for (const plan of group) {
          const initialClaim = buildLockedClaimInstructions(
            plan,
            claimant.publicKey.toBase58(),
          );
          const status = await connection.getAccountInfo(
            initialClaim[0].keys[1].pubkey,
          );
          await send(
            connection,
            claimant,
            buildLockedClaimInstructions(
              plan,
              claimant.publicKey.toBase58(),
              !!status,
            ),
          );
          claimed += 100n;
          assert.equal(
            (await getAccount(connection, destination.address)).amount,
            claimed,
          );
          try {
            await send(
              connection,
              claimant,
              buildLockedClaimInstructions(plan, claimant.publicKey.toBase58()),
            );
          } catch {
            /* Duplicate initialization is rejected or transaction replay is idempotent. */
          }
          // After a lost confirmation, inspect the status PDA and retry withdrawal only.
          const retry = buildLockedClaimInstructions(
            plan,
            claimant.publicKey.toBase58(),
            true,
          );
          try {
            await send(connection, claimant, retry);
          } catch {
            /* Pinned program may reject an empty withdrawal. */
          }
          assert.equal(
            (await getAccount(connection, destination.address)).amount,
            claimed,
          );
        }
      }
      assert.equal(claimed, 10000n);
      assert.equal((await getAccount(connection, source.address)).amount, 0n);
      const last = plans.at(-1);
      net.timeTravelToTimestamp((last.expected.clawbackAt + 1) * 1000);
      const receiver = new PublicKey(last.expected.clawbackReceiver);
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        payer.publicKey,
      );
      const clawback = new TransactionInstruction({
        programId: JITO_PROGRAM,
        keys: [
          {
            pubkey: new PublicKey(last.expected.distributor),
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: new PublicKey(last.expected.tokenVault),
            isSigner: false,
            isWritable: true,
          },
          { pubkey: receiver, isSigner: false, isWritable: true },
          { pubkey: claimant.publicKey, isSigner: true, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: disc("clawback"),
      });
      await send(connection, claimant, [clawback]);
      assert.equal(
        decodeDistributor(
          last,
          await connection.getAccountInfo(
            new PublicKey(last.expected.distributor),
          ),
        ).clawedBack,
        true,
      );
    } finally {
      net.stop();
    }
  },
);
