/** Executable simulator adapter. No mainnet endpoint, funded vault or production import is allowed. */
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
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import { installPrograms } from "./programs.mjs";
import { loopback, rpc, hash } from "./safety.mjs";
export async function startSolana() {
  const { Surfnet } = await import("@solana/surfpool");
  const net = Surfnet.startWithConfig({
    offline: true,
    blockProductionMode: "transaction",
  });
  loopback(net.rpcUrl);
  installPrograms(net);
  return {
    net,
    connection: new Connection(net.rpcUrl, {
      commitment: "confirmed",
      wsEndpoint: net.wsUrl,
    }),
    payer: Keypair.fromSecretKey(net.payerSecretKey),
  };
}
export async function chainTime(connection) {
  loopback(connection.rpcEndpoint);
  const a = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
  return Number(a.data.readBigInt64LE(32)) * 1000;
}
export async function sendFixtureInstructions(
  connection,
  payer,
  instructions,
  others = [],
) {
  loopback(connection.rpcEndpoint);
  const block = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer.publicKey, ...block }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
    ...instructions,
  );
  tx.sign(payer, ...others);
  return connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 0,
  });
}
export async function createLocalMint(connection, payer, decimals) {
  const mint = Keypair.generate(),
    lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  await sendFixtureInstructions(
    connection,
    payer,
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mint.publicKey,
        decimals,
        payer.publicKey,
        null,
      ),
    ],
    [mint],
  );
  return mint.publicKey;
}
export async function createLocalAta(connection, payer, mint, owner) {
  const address = getAssociatedTokenAddressSync(mint, owner);
  await sendFixtureInstructions(connection, payer, [
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      address,
      owner,
      mint,
    ),
  ]);
  return { address };
}
export async function mintLocal(connection, payer, mint, address, amount) {
  await sendFixtureInstructions(connection, payer, [
    createMintToInstruction(mint, address, payer.publicKey, amount),
  ]);
}
export function instructionsForPlan(instructions) {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
    ...instructions,
  ].map((ix) => ({
    program: ix.programId.toBase58(),
    accounts: ix.keys.map((k) => ({
      address: k.pubkey.toBase58(),
      signer: k.isSigner,
      writable: k.isWritable,
    })),
    data: ix.data.toString("hex"),
    description: "Local verified program instruction",
  }));
}
function requireLocal(connection, plan) {
  loopback(connection.rpcEndpoint);
  if (plan.network !== "solana-local" || plan.simulated !== true)
    throw Error("Simulator plans only; mainnet is unavailable");
}
async function transaction(connection, plan) {
  requireLocal(connection, plan);
  const block = await connection.getLatestBlockhash("confirmed");
  return new Transaction({
    feePayer: new PublicKey(plan.signers[0]),
    ...block,
  }).add(
    ...plan.instructions.map(
      (i) =>
        new TransactionInstruction({
          programId: new PublicKey(i.program),
          keys: i.accounts.map((a) => ({
            pubkey: new PublicKey(a.address),
            isSigner: a.signer,
            isWritable: a.writable,
          })),
          data: Buffer.from(i.data, "hex"),
        }),
    ),
  );
}
const stable = (value) => JSON.stringify(value, Object.keys(value).sort());
/** Expected-state reader is operation-specific and must return independently observed values. */
export function localReadAdapter(connection, observeExpected) {
  return {
    async simulate(plan, planHash) {
      requireLocal(connection, plan);
      const tx = await transaction(connection, plan),
        before = await connection.getBalance(new PublicKey(plan.signers[0]));
      const result = await rpc(connection.rpcEndpoint, "simulateTransaction", [
        tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        {
          encoding: "base64",
          sigVerify: false,
          accounts: { encoding: "base64", addresses: [plan.signers[0]] },
          commitment: "confirmed",
        },
      ]);
      const after = result.value.accounts?.[0]?.lamports;
      if (result.value.err || !Number.isSafeInteger(after))
        throw Error("Local simulation failed or fee-payer cost unavailable");
      return {
        planHash,
        success: true,
        cost: String(Math.max(0, before - after)),
        context: "solana-local:" + result.context.slot,
        expectedHash: hash(stable(plan.expected)),
        observedAt: Date.now(),
      };
    },
    async inspect(plan, planHash, signature) {
      requireLocal(connection, plan);
      if (!signature)
        return {
          status: "absent",
          network: plan.network,
          planHash,
          signature: null,
          expectedHash: hash(stable(plan.expected)),
          context: "local-search-incomplete",
          expired: false,
          complete: false,
        };
      const result = await rpc(connection.rpcEndpoint, "getTransaction", [
        signature,
        {
          encoding: "base64",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      if (!result)
        return {
          status: "pending",
          network: plan.network,
          planHash,
          signature,
          expectedHash: hash(stable(plan.expected)),
          context: "not-yet-observed",
          expired: false,
          complete: false,
        };
      const tx = Transaction.from(Buffer.from(result.transaction[0], "base64"));
      const semantic = [];
      for (const ix of tx.instructions)
        semantic.push({
          program: ix.programId.toBase58(),
          accounts: ix.keys.map((k) => ({
            address: k.pubkey.toBase58(),
            signer: k.isSigner,
            writable: k.isWritable,
          })),
          data: ix.data.toString("hex"),
        });
      // Wire-format account privileges are message-wide unions. Compare data, account order,
      // signers and required privileges while rejecting extra instructions or accounts.
      if (
        !tx.feePayer?.equals(new PublicKey(plan.signers[0])) ||
        semantic.length !== plan.instructions.length ||
        !tx.verifySignatures()
      )
        throw Error("Observed transaction does not match the approved plan");
      const privileges = new Map([
        [plan.signers[0], { signer: true, writable: true }],
      ]);
      for (const ix of plan.instructions)
        for (const a of ix.accounts) {
          const old = privileges.get(a.address) ?? {
            signer: false,
            writable: false,
          };
          privileges.set(a.address, {
            signer: old.signer || a.signer,
            writable: old.writable || a.writable,
          });
        }
      for (let n = 0; n < semantic.length; n++) {
        const a = semantic[n],
          b = plan.instructions[n];
        if (
          a.program !== b.program ||
          a.data !== b.data ||
          a.accounts.length !== b.accounts.length ||
          a.accounts.some(
            (k, i) =>
              k.address !== b.accounts[i].address ||
              k.signer !== privileges.get(k.address).signer ||
              k.writable !== privileges.get(k.address).writable,
          )
        )
          throw Error("Observed instruction mismatch");
      }
      const observed = result.meta.err
        ? plan.expected
        : await observeExpected(plan);
      const statuses = await rpc(
        connection.rpcEndpoint,
        "getSignatureStatuses",
        [[signature], { searchTransactionHistory: true }],
      );
      const status = statuses.value?.[0];
      if (!status || status.slot !== result.slot)
        throw Error("Local signature status is unavailable or inconsistent");
      const finalized = status.confirmationStatus === "finalized";
      return {
        status: finalized
          ? result.meta.err
            ? "failed"
            : "finalized"
          : "confirmed",
        network: plan.network,
        planHash,
        signature,
        expectedHash: hash(stable(observed)),
        context: "solana-local:" + result.slot,
        expired: false,
        complete: finalized,
      };
    },
  };
}
export async function sendLocalPlan(connection, plan, signers) {
  requireLocal(connection, plan);
  const allowed = new Set(plan.signers);
  if (
    signers.length !== allowed.size ||
    signers.some((k) => !allowed.has(k.publicKey.toBase58()))
  )
    throw Error("Local signers differ from plan");
  if (Date.now() < plan.notBefore || Date.now() >= plan.expiresAt)
    throw Error("Outside intent window");
  const tx = await transaction(connection, plan);
  tx.sign(...signers);
  return connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 0,
  });
}
