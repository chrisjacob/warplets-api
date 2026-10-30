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
  VersionedTransaction,
  VersionedMessage,
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
import { localInspector } from "./local-solana-read.mjs";
import {
  bytesHash,
  messageBytes,
  validatePacket,
} from "../../../meme/src/shared/packets.ts";
import { canonical } from "../../../meme/src/shared/canonical.ts";
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
export async function prepareLocalPacket(
  connection,
  plan,
  attemptId,
  planHash,
) {
  requireLocal(connection, plan);
  const genesisHash = await connection.getGenesisHash(),
    latest = await connection.getLatestBlockhashAndContext("confirmed");
  const tx = new Transaction({
    feePayer: new PublicKey(plan.signers[0]),
    ...latest.value,
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
  const message = tx.serializeMessage();
  const packet = {
    version: 1,
    network: plan.network,
    attemptId,
    planHash,
    genesisHash,
    messageBase64: message.toString("base64"),
    messageHash: await bytesHash(message),
    lifetime: {
      kind: "recent-blockhash",
      blockhash: latest.value.blockhash,
      lastValidBlockHeight: latest.value.lastValidBlockHeight,
      contextSlot: latest.context.slot,
      observedAt: Date.now(),
    },
    lookupTables: [],
  };
  await validatePacket(plan, attemptId, planHash, packet);
  return packet;
}
function reviewedTransaction(review) {
  if (review.id !== "packet:" + hash(canonical(review.packet)))
    throw Error("Reviewed packet changed before signing/simulation");
  return new VersionedTransaction(
    VersionedMessage.deserialize(messageBytes(review.packet.messageBase64)),
  );
}
/** Expected-state reader is operation-specific and must return independently observed values. */
export function localReadAdapter(connection, observeExpected, review = null) {
  return {
    async simulate(plan, planHash) {
      requireLocal(connection, plan);
      const tx = review
          ? reviewedTransaction(review)
          : await transaction(connection, plan),
        before = await connection.getBalance(new PublicKey(plan.signers[0]));
      const result = await rpc(connection.rpcEndpoint, "simulateTransaction", [
        review
          ? Buffer.from(tx.serialize()).toString("base64")
          : tx
              .serialize({
                requireAllSignatures: false,
                verifySignatures: false,
              })
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
        ...(review ? { packetHash: review.id } : {}),
      };
    },
    inspect: localInspector(
      connection,
      observeExpected,
      rpc,
      review?.packet ?? null,
    ),
  };
}
export async function sendLocalPlan(connection, plan, signers, review = null) {
  requireLocal(connection, plan);
  const allowed = new Set(plan.signers);
  if (
    signers.length !== allowed.size ||
    signers.some((k) => !allowed.has(k.publicKey.toBase58()))
  )
    throw Error("Local signers differ from plan");
  if (Date.now() < plan.notBefore || Date.now() >= plan.expiresAt)
    throw Error("Outside intent window");
  const tx = review
    ? reviewedTransaction(review)
    : await transaction(connection, plan);
  if (review) tx.sign(signers);
  else tx.sign(...signers);
  return connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 0,
  });
}
