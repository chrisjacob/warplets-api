import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import * as multisig from "@sqds/multisig";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  TransactionMessage,
} from "@solana/web3.js";
import { createTransferInstruction, getAccount } from "@solana/spl-token";
import {
  startSolana,
  chainTime,
  sendFixtureInstructions,
  createLocalMint,
  createLocalAta,
  mintLocal,
} from "../src/local-solana.mjs";
import { hash } from "../src/safety.mjs";
import { createHash } from "node:crypto";
import { TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  JITO_PROGRAM,
  planLockedJito,
  assertJitoAccount,
  buildLockedClaimInstructions,
} from "../../meme-protocol/src/jito-locked.mjs";
import { decodeDistributor } from "../src/jito-account.mjs";
const programId = new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"),
  root = resolve(import.meta.dirname, "../../..");
test(
  "actual pinned Squads source enforces 2-of-3, timelock and one vault CPI transfer",
  { timeout: 120000 },
  async () => {
    if (process.platform !== "linux" || process.arch !== "x64")
      throw Error(
        "Custody runtime proof requires Linux x64; use the dedicated CI job",
      );
    if (!process.env.MEME_SQUADS_ELF)
      throw Error(
        "Pinned source build is required, never silently skip custody proof",
      );
    const elf = readFileSync(resolve(root, process.env.MEME_SQUADS_ELF));
    assert.equal(elf.subarray(0, 4).toString("hex"), "7f454c46");
    const { net, connection, payer } = await startSolana(),
      costs = [];
    try {
      net.deploy({ programId: programId.toBase58(), soBytes: elf });
      const members = [
          Keypair.generate(),
          Keypair.generate(),
          Keypair.generate(),
        ],
        stranger = Keypair.generate(),
        createKey = Keypair.generate();
      for (const signer of [...members, stranger])
        net.fundSol(signer.publicKey.toBase58(), 10000000000);
      const [configPda] = multisig.getProgramConfigPda({ programId }),
        [multisigPda] = multisig.getMultisigPda({
          createKey: createKey.publicKey,
          programId,
        }),
        [vault] = multisig.getVaultPda({ multisigPda, index: 0, programId });
      // Explicit LOCAL program-config fixture: zero creation fee is not a mainnet cost quotation.
      const config = multisig.accounts.ProgramConfig.fromArgs({
        authority: payer.publicKey,
        multisigCreationFee: 0n,
        treasury: payer.publicKey,
        reserved: Array(64).fill(0),
      }).serialize()[0];
      net.setAccount(
        configPda.toBase58(),
        10000000,
        config,
        programId.toBase58(),
      );
      async function send(label, instructions, signers = []) {
        const before = await connection.getBalance(payer.publicKey);
        const signature = await sendFixtureInstructions(
          connection,
          payer,
          instructions,
          signers,
        );
        const after = await connection.getBalance(payer.publicKey);
        costs.push({ label, signature, payerLamports: String(before - after) });
        return signature;
      }
      await send(
        "Create local 2-of-3 multisig",
        [
          multisig.instructions.multisigCreateV2({
            programId,
            treasury: payer.publicKey,
            creator: payer.publicKey,
            multisigPda,
            configAuthority: null,
            threshold: 2,
            members: members.map((m) => ({
              key: m.publicKey,
              permissions: multisig.types.Permissions.all(),
            })),
            timeLock: 3600,
            createKey: createKey.publicKey,
            rentCollector: payer.publicKey,
            memo: "Disposable custody proof",
          }),
        ],
        [createKey],
      );
      const state = await multisig.accounts.Multisig.fromAccountAddress(
        connection,
        multisigPda,
      );
      assert.equal(state.threshold, 2);
      assert.equal(state.members.length, 3);
      assert(state.configAuthority.equals(PublicKey.default));
      assert.equal(state.timeLock, 3600);
      net.fundSol(vault.toBase58(), 10000000000);
      const mint = await createLocalMint(connection, payer, 9),
        source = await createLocalAta(connection, payer, mint, vault, true),
        receiver = await createLocalAta(
          connection,
          payer,
          mint,
          members[2].publicKey,
        );
      await mintLocal(connection, payer, mint, source.address, 100n);
      const transfer = createTransferInstruction(
          source.address,
          receiver.address,
          vault,
          25n,
        ),
        transactionIndex = 1n;
      const message = new TransactionMessage({
        payerKey: vault,
        recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
        instructions: [transfer],
      });
      await send(
        "Prepare exact vault transfer",
        [
          multisig.instructions.vaultTransactionCreate({
            programId,
            multisigPda,
            transactionIndex,
            creator: members[0].publicKey,
            rentPayer: payer.publicKey,
            vaultIndex: 0,
            ephemeralSigners: 0,
            transactionMessage: message,
          }),
          multisig.instructions.proposalCreate({
            programId,
            multisigPda,
            transactionIndex,
            creator: members[0].publicKey,
            rentPayer: payer.publicKey,
          }),
        ],
        [members[0]],
      );
      const approve = (member) =>
        multisig.instructions.proposalApprove({
          programId,
          multisigPda,
          transactionIndex,
          member: member.publicKey,
        });
      const execute = async () =>
        (
          await multisig.instructions.vaultTransactionExecute({
            programId,
            connection,
            multisigPda,
            transactionIndex,
            member: members[0].publicKey,
          })
        ).instruction;
      await assert.rejects(
        send("Reject unknown signer", [approve(stranger)], [stranger]),
      );
      await send("First approval", [approve(members[0])], [members[0]]);
      await assert.rejects(
        send("Reject 1-of-3 execution", [await execute()], [members[0]]),
      );
      assert.equal((await getAccount(connection, receiver.address)).amount, 0n);
      await send("Second approval", [approve(members[1])], [members[1]]);
      await assert.rejects(
        send(
          "Reject early timelock execution",
          [await execute()],
          [members[0]],
        ),
      );
      net.timeTravelToTimestamp(
        (Math.floor((await chainTime(connection)) / 1000) + 3601) * 1000,
      );
      await send("Execute vault CPI once", [await execute()], [members[0]]);
      assert.equal(
        (await getAccount(connection, receiver.address)).amount,
        25n,
      );
      assert.equal((await getAccount(connection, source.address)).amount, 75n);
      await assert.rejects(
        send("Reject duplicate execution", [await execute()], [members[0]]),
      );
      assert.equal(
        (await getAccount(connection, receiver.address)).amount,
        25n,
      );
      await assert.rejects(
        send(
          "Reject unilateral threshold change",
          [
            multisig.instructions.multisigChangeThreshold({
              programId,
              multisigPda,
              configAuthority: members[0].publicKey,
              rentPayer: payer.publicKey,
              newThreshold: 1,
            }),
          ],
          [members[0]],
        ),
      );
      // Exercise the actual distributor with admin AND receiver under this vault's CPI authority.
      let governedIndex = 1n;
      async function governed(label, instructions) {
        const index = ++governedIndex,
          message = new TransactionMessage({
            payerKey: vault,
            recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
            instructions,
          });
        await send(
          label + " prepare",
          [
            multisig.instructions.vaultTransactionCreate({
              programId,
              multisigPda,
              transactionIndex: index,
              creator: members[0].publicKey,
              rentPayer: payer.publicKey,
              vaultIndex: 0,
              ephemeralSigners: 0,
              transactionMessage: message,
            }),
            multisig.instructions.proposalCreate({
              programId,
              multisigPda,
              transactionIndex: index,
              creator: members[0].publicKey,
              rentPayer: payer.publicKey,
            }),
          ],
          [members[0]],
        );
        const approval = (member) =>
          multisig.instructions.proposalApprove({
            programId,
            multisigPda,
            transactionIndex: index,
            member: member.publicKey,
          });
        const execution = async () =>
          (
            await multisig.instructions.vaultTransactionExecute({
              programId,
              connection,
              multisigPda,
              transactionIndex: index,
              member: members[0].publicKey,
            })
          ).instruction;
        await send(
          label + " first approval",
          [approval(members[0])],
          [members[0]],
        );
        await assert.rejects(
          send(label + " 1-of-3 rejected", [await execution()], [members[0]]),
        );
        await send(
          label + " second approval",
          [approval(members[1])],
          [members[1]],
        );
        net.timeTravelToTimestamp(
          (Math.floor((await chainTime(connection)) / 1000) + 3601) * 1000,
        );
        await send(label + " execute", [await execution()], [members[0]]);
        await assert.rejects(
          send(
            label + " duplicate rejected",
            [await execution()],
            [members[0]],
          ),
        );
      }
      const creationTime = Math.floor((await chainTime(connection)) / 1000),
        claimant = members[1];
      const claimantAccount = await createLocalAta(
        connection,
        payer,
        mint,
        claimant.publicKey,
      );
      const distribution = planLockedJito({
        simulated: true,
        state: "finalized_unfunded",
        allocationId: "custody:cpi",
        inputHash: "a".repeat(64),
        resultHash: "b".repeat(64),
        version: "9000",
        mint: mint.toBase58(),
        admin: vault.toBase58(),
        receiverOwner: vault.toBase58(),
        launchedAtMs: creationTime * 1000,
        releaseIndex: 1,
        preparedAt: creationTime,
        expectedAmount: "50",
        recipients: [
          { wallet: claimant.publicKey.toBase58(), amount: "20" },
          { wallet: members[2].publicKey.toBase58(), amount: "30" },
        ],
      });
      await governed("Jito create with vault admin", [distribution.creation]);
      const distributor = new PublicKey(distribution.expected.distributor),
        rewardVault = new PublicKey(distribution.expected.tokenVault);
      const readDistribution = async () =>
        decodeDistributor(
          distribution,
          await connection.getAccountInfo(distributor, "finalized"),
        );
      assertJitoAccount(distribution, await readDistribution());
      assert.equal(
        distribution.expected.clawbackReceiver,
        source.address.toBase58(),
      );
      assert(
        (await getAccount(connection, source.address)).owner.equals(vault),
      );
      const discriminator = (name) =>
        createHash("sha256")
          .update("global:" + name)
          .digest()
          .subarray(0, 8);
      const setReceiver = (admin, target) =>
        new TransactionInstruction({
          programId: JITO_PROGRAM,
          keys: [
            { pubkey: distributor, isSigner: false, isWritable: true },
            { pubkey: target, isSigner: false, isWritable: false },
            { pubkey: admin, isSigner: true, isWritable: true },
          ],
          data: discriminator("set_clawback_receiver"),
        });
      const setAdmin = new TransactionInstruction({
        programId: JITO_PROGRAM,
        keys: [
          { pubkey: distributor, isSigner: false, isWritable: true },
          { pubkey: members[0].publicKey, isSigner: true, isWritable: true },
          { pubkey: members[2].publicKey, isSigner: false, isWritable: true },
        ],
        data: discriminator("set_admin"),
      });
      await assert.rejects(
        send(
          "Single member cannot replace Jito admin",
          [setAdmin],
          [members[0]],
        ),
      );
      await assert.rejects(
        send(
          "Single member cannot replace Jito receiver",
          [setReceiver(members[0].publicKey, receiver.address)],
          [members[0]],
        ),
      );
      await governed("Detect changed receiver policy", [
        setReceiver(vault, receiver.address),
      ]);
      assert.throws(() => assertJitoAccount(distribution, {}));
      await assert.rejects(
        async () => assertJitoAccount(distribution, await readDistribution()),
        /clawbackReceiver/,
      );
      assert.equal((await getAccount(connection, rewardVault)).amount, 0n);
      await governed("Restore accepted receiver policy", [
        setReceiver(vault, source.address),
      ]);
      assertJitoAccount(distribution, await readDistribution());
      await governed("Fund verified distributor from vault", [
        createTransferInstruction(source.address, rewardVault, vault, 50n),
      ]);
      assert.equal((await getAccount(connection, rewardVault)).amount, 50n);
      // A funded direct claimant does NOT need the app, multisig or a fresh operator approval.
      net.timeTravelToTimestamp(
        (distribution.expected.endVestingAt + 1) * 1000,
      );
      await send(
        "Direct released claimant",
        buildLockedClaimInstructions(
          distribution,
          claimant.publicKey.toBase58(),
        ),
        [claimant],
      );
      assert.equal(
        (await getAccount(connection, claimantAccount.address)).amount,
        20n,
      );
      assert.equal((await getAccount(connection, rewardVault)).amount, 30n);
      const clawback = new TransactionInstruction({
        programId: JITO_PROGRAM,
        keys: [
          { pubkey: distributor, isSigner: false, isWritable: true },
          { pubkey: rewardVault, isSigner: false, isWritable: true },
          { pubkey: source.address, isSigner: false, isWritable: true },
          { pubkey: stranger.publicKey, isSigner: true, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: discriminator("clawback"),
      });
      net.timeTravelToTimestamp((distribution.expected.clawbackAt - 1) * 1000);
      await assert.rejects(
        send("Early permissionless clawback rejected", [clawback], [stranger]),
      );
      net.timeTravelToTimestamp((distribution.expected.clawbackAt + 1) * 1000);
      await send(
        "Permissionless clawback to vault custody",
        [clawback],
        [stranger],
      );
      assert.equal((await getAccount(connection, source.address)).amount, 55n);
      assert.equal((await getAccount(connection, rewardVault)).amount, 0n);
      assert.equal(
        (await getAccount(connection, receiver.address)).amount +
          (await getAccount(connection, claimantAccount.address)).amount +
          (await getAccount(connection, source.address)).amount,
        100n,
      );
      const out = resolve(root, ".tmp/meme-qa/custody");
      mkdirSync(out, { recursive: true });
      writeFileSync(
        resolve(out, "execution.json"),
        JSON.stringify(
          {
            source: "af94153ff77a28b6effe46b9c94baaa93742b48c",
            elfHash: hash(elf),
            network: "solana-local",
            threshold: "2-of-3",
            timelockSeconds: 3600,
            programConfig: "synthetic zero-fee fixture",
            sourceMatchesDeployedMainnet: false,
            productionCustodyApproved: false,
            distributorVaultCpi: true,
            receiverPolicyDriftDetected: true,
            directClaimIndependentOfApp: true,
            permissionlessClawbackToVault: true,
            tokenConservation: "100",
            mainnetWrites: false,
            costs,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      net.stop();
    }
  },
);
