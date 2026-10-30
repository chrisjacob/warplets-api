/** Read-only simulator reconciliation. No signing, broadcast or mainnet endpoint. */
import { isDeepStrictEqual } from "node:util";
import { createPublicKey, verify } from "node:crypto";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { loopback, rpc, hash } from "./safety.mjs";
import {
  bytesHash,
  validatePacket,
  messageBytes,
  decodeMessage,
} from "../../../meme/src/shared/packets.ts";
import { decode58 } from "../../../meme/src/shared/base58.ts";

const stable = (value) => JSON.stringify(value, Object.keys(value).sort());
const slot = (value) => Number.isSafeInteger(value) && value >= 0;
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function signature58(bytes) {
  let n = BigInt("0x" + bytes.toString("hex")),
    text = "";
  while (n) {
    text = alphabet[Number(n % 58n)] + text;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = "1" + text;
  }
  return text;
}

async function validateTransaction(
  plan,
  signature,
  result,
  expectedSlot,
  packet,
) {
  if (
    !result ||
    !slot(result.slot) ||
    (expectedSlot !== undefined && result.slot !== expectedSlot) ||
    !Array.isArray(result.transaction) ||
    result.transaction.length !== 2 ||
    result.transaction[1] !== "base64" ||
    typeof result.transaction[0] !== "string" ||
    result.transaction[0].length > 1644 ||
    !result.meta ||
    !Object.hasOwn(result.meta, "err") ||
    (result.meta.err !== null &&
      (typeof result.meta.err !== "object" ||
        Array.isArray(result.meta.err))) ||
    !Number.isSafeInteger(result.meta.fee) ||
    result.meta.fee < 0 ||
    BigInt(result.meta.fee) > BigInt(plan.maximumCost)
  )
    throw Error(
      "Incomplete transaction evidence, wrong slot or fee ceiling exceeded",
    );
  const wire = Buffer.from(result.transaction[0], "base64");
  if (wire.toString("base64") !== result.transaction[0] || wire.length > 1232)
    throw Error("Invalid transaction encoding");
  if (packet) {
    await validatePacket(
      plan,
      packet.attemptId,
      packet.planHash,
      packet,
      packet.lifetime.observedAt,
    );
    const tx = VersionedTransaction.deserialize(wire),
      message = tx.message.serialize(),
      decoded = decodeMessage(message, packet.lookupTables);
    if (
      (await bytesHash(message)) !== packet.messageHash ||
      signature58(Buffer.from(tx.signatures[0])) !== signature ||
      !Buffer.from(tx.serialize()).equals(wire) ||
      tx.signatures.length !== decoded.signers.length
    )
      throw Error("Observed transaction differs from the reviewed packet");
    for (let i = 0; i < decoded.signers.length; i++) {
      const key = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          Buffer.from(decode58(decoded.signers[i], 32)),
        ]),
        format: "der",
        type: "spki",
      });
      if (
        !verify(null, Buffer.from(message), key, Buffer.from(tx.signatures[i]))
      )
        throw Error("Invalid reviewed transaction signature");
    }
    return result;
  }
  const tx = Transaction.from(wire);
  if (
    !tx.signature ||
    signature58(tx.signature) !== signature ||
    !tx.verifySignatures() ||
    !tx.serialize().equals(wire) ||
    !tx.feePayer?.equals(new PublicKey(plan.signers[0])) ||
    tx.signatures.length !== plan.signers.length ||
    tx.signatures.some((s) => !plan.signers.includes(s.publicKey.toBase58())) ||
    tx.instructions.length !== plan.instructions.length
  )
    throw Error(
      "Observed transaction does not match the requested signature and approved plan",
    );

  // Wire privileges are message-wide unions. Reject additional instructions, accounts,
  // signers and privileges, while allowing the unions required by the approved message.
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
  for (let n = 0; n < tx.instructions.length; n++) {
    const actual = tx.instructions[n],
      expected = plan.instructions[n];
    if (
      actual.programId.toBase58() !== expected.program ||
      actual.data.toString("hex") !== expected.data ||
      actual.keys.length !== expected.accounts.length ||
      actual.keys.some((a, i) => {
        const address = a.pubkey.toBase58(),
          privilege = privileges.get(address);
        return (
          address !== expected.accounts[i].address ||
          a.isSigner !== privilege?.signer ||
          a.isWritable !== privilege?.writable
        );
      })
    )
      throw Error("Observed instruction mismatch");
  }
  return result;
}

/** Injectable RPC transport permits deterministic outage/fork fixtures, always loopback-only. */
export function localInspector(
  connection,
  observeExpected,
  read = rpc,
  packet = null,
) {
  return async function inspect(plan, planHash, signature) {
    loopback(connection.rpcEndpoint);
    if (plan.network !== "solana-local" || plan.simulated !== true)
      throw Error("Simulator plans only; mainnet is unavailable");
    if (packet && packet.planHash !== planHash)
      throw Error("Packet differs from immutable plan");
    const base = {
      network: plan.network,
      planHash,
      signature,
      expectedHash: hash(stable(plan.expected)),
      expired: false,
      complete: false,
      commitment: "unknown",
    };
    if (signature === null)
      return { ...base, status: "absent", context: "local-search-incomplete" };
    if (
      typeof signature !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)
    )
      throw Error("Invalid Solana signature");
    const get = (commitment) =>
      read(connection.rpcEndpoint, "getTransaction", [
        signature,
        { encoding: "base64", commitment, maxSupportedTransactionVersion: 0 },
      ]);
    const result = await get("confirmed");
    if (result === null)
      return { ...base, status: "pending", context: "not-yet-observed" };
    await validateTransaction(plan, signature, result, undefined, packet);
    const statuses = await read(
      connection.rpcEndpoint,
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: true }],
    );
    if (
      !statuses ||
      !slot(statuses.context?.slot) ||
      !Array.isArray(statuses.value) ||
      statuses.value.length !== 1
    )
      throw Error("Malformed signature status response");
    const status = statuses.value[0];
    if (status === null)
      return {
        ...base,
        status: "pending",
        context: "signature-status-unavailable",
      };
    if (
      !status ||
      !slot(status.slot) ||
      status.slot !== result.slot ||
      statuses.context.slot < status.slot ||
      !["processed", "confirmed", "finalized"].includes(
        status.confirmationStatus,
      ) ||
      !Object.hasOwn(status, "err") ||
      !isDeepStrictEqual(status.err, result.meta.err)
    )
      throw Error("Signature status and transaction evidence disagree");

    const commitment = status.confirmationStatus;
    const context = "solana-local:" + result.slot;
    if (commitment !== "finalized")
      return {
        ...base,
        commitment,
        context,
        // A confirmed error is not a finalized failure and must not permit retry.
        status:
          commitment === "confirmed" && result.meta.err === null
            ? "confirmed"
            : "pending",
      };

    // A finalized status alone does not certify a transaction body read from a fork.
    const finalized = await get("finalized");
    if (finalized === null)
      return {
        ...base,
        status: "pending",
        context: "finalized-body-unavailable",
      };
    await validateTransaction(plan, signature, finalized, result.slot, packet);
    if (
      !isDeepStrictEqual(finalized.meta.err, status.err) ||
      finalized.meta.fee !== result.meta.fee ||
      finalized.transaction[0] !== result.transaction[0]
    )
      throw Error("Finalized transaction evidence changed");
    const observed =
      finalized.meta.err === null
        ? await observeExpected(plan, {
            commitment: "finalized",
            minContextSlot: finalized.slot,
          })
        : plan.expected;
    if (hash(stable(observed)) !== base.expectedHash)
      throw Error("Finalized account state does not match the approved plan");
    return {
      ...base,
      status: finalized.meta.err === null ? "finalized" : "failed",
      commitment,
      context,
      complete: true,
    };
  };
}
