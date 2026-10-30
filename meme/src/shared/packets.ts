import { decode58, encode58 } from "./base58";
import { canonical } from "./canonical";
import type { TransactionPlan } from "./transactions";
export const SOLANA_MAINNET_GENESIS =
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export interface LookupEvidence {
  address: string;
  contextSlot: number;
  dataHash: string;
  addresses: string[];
}
export interface PreparedPacket {
  version: 1;
  network: "solana-local" | "solana-mainnet";
  attemptId: string;
  planHash: string;
  genesisHash: string;
  messageBase64: string;
  messageHash: string;
  lifetime: {
    kind: "recent-blockhash";
    blockhash: string;
    lastValidBlockHeight: number;
    contextSlot: number;
    observedAt: number;
  };
  lookupTables: LookupEvidence[];
}
export interface DecodedMessage {
  version: "legacy" | 0;
  blockhash: string;
  signers: string[];
  accounts: { address: string; signer: boolean; writable: boolean }[];
  instructions: TransactionPlan["instructions"];
}
export function messageBytes(base64: string) {
  if (
    typeof base64 !== "string" ||
    base64.length === 0 ||
    base64.length > 1644 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw Error("Invalid message encoding");
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  if (bytes.length > 1232 || btoa(String.fromCharCode(...bytes)) !== base64)
    throw Error("Invalid message encoding");
  return bytes;
}
export async function bytesHash(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Canonical bounded Solana legacy/v0 message decoder. No signer or external dependency. */
export function decodeMessage(
  bytes: Uint8Array,
  tables: LookupEvidence[] = [],
): DecodedMessage {
  let offset = 0;
  const take = (count: number) => {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      offset + count > bytes.length
    )
      throw Error("Truncated message");
    const result = bytes.slice(offset, offset + count);
    offset += count;
    return result;
  };
  const byte = () => take(1)[0];
  const short = () => {
    let result = 0;
    for (let i = 0; i < 3; i++) {
      const value = byte();
      result += (value & 127) * 2 ** (7 * i);
      if (!(value & 128)) {
        if ((i > 0 && value === 0) || result > 65535)
          throw Error("Noncanonical short vector");
        return result;
      }
    }
    throw Error("Oversized short vector");
  };
  if (!bytes.length || bytes.length > 1232)
    throw Error("Invalid message length");
  let first = byte(),
    version: "legacy" | 0 = "legacy";
  if (first & 128) {
    if (first !== 128) throw Error("Unsupported message version");
    version = 0;
    first = byte();
  }
  const signatures = first,
    readonlySigned = byte(),
    readonlyUnsigned = byte(),
    count = short();
  if (
    signatures < 1 ||
    signatures > 4 ||
    count < signatures ||
    count > 256 ||
    readonlySigned >= signatures ||
    readonlyUnsigned > count - signatures ||
    bytes.length + 1 + 64 * signatures > 1232
  )
    throw Error("Invalid or oversized message header");
  const accounts: DecodedMessage["accounts"] = [];
  for (let i = 0; i < count; i++)
    accounts.push({
      address: encode58(take(32)),
      signer: i < signatures,
      writable:
        i < signatures
          ? i < signatures - readonlySigned
          : i < count - readonlyUnsigned,
    });
  const blockhash = encode58(take(32)),
    instructionCount = short();
  if (instructionCount < 1 || instructionCount > 20)
    throw Error("Invalid instruction count");
  const raw: { program: number; indices: number[]; data: string }[] = [];
  for (let n = 0; n < instructionCount; n++) {
    const program = byte(),
      length = short();
    if (length > 64) throw Error("Too many instruction accounts");
    const indices = [...take(length)];
    const data = Array.from(take(short()), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    raw.push({ program, indices, data });
  }
  const writable: string[] = [],
    readonly: string[] = [],
    used = new Set<string>();
  if (version === 0) {
    const lookups = short();
    if (lookups > 8) throw Error("Too many lookup tables");
    for (let n = 0; n < lookups; n++) {
      const address = encode58(take(32)),
        table = tables.find((t) => t.address === address);
      if (!table || used.has(address))
        throw Error("Missing or repeated lookup evidence");
      used.add(address);
      for (const target of [writable, readonly]) {
        const length = short();
        if (length > 256) throw Error("Lookup count exceeds limit");
        for (const index of take(length)) {
          const value = table.addresses[index];
          if (!value) throw Error("Missing lookup address");
          decode58(value, 32);
          target.push(value);
        }
      }
    }
  }
  if (offset !== bytes.length || used.size !== tables.length)
    throw Error("Trailing bytes or unused lookup evidence");
  for (const address of writable)
    accounts.push({ address, signer: false, writable: true });
  for (const address of readonly)
    accounts.push({ address, signer: false, writable: false });
  if (
    accounts.length > 256 ||
    new Set(accounts.map((a) => a.address)).size !== accounts.length
  )
    throw Error("Duplicate or oversized account list");
  const instructions = raw.map((ix) => {
    const program = accounts[ix.program];
    if (!program || ix.indices.some((i) => !accounts[i]))
      throw Error("Instruction references unknown account");
    if (
      program.address === "11111111111111111111111111111111" &&
      ix.data.startsWith("04000000")
    )
      throw Error("Durable nonce transactions are unsupported");
    return {
      program: program.address,
      accounts: ix.indices.map((i) => accounts[i]),
      data: ix.data,
      description: "Decoded reviewed instruction",
    };
  });
  return {
    version,
    blockhash,
    signers: accounts.slice(0, signatures).map((a) => a.address),
    accounts,
    instructions,
  };
}
export async function validatePacket(
  plan: Pick<TransactionPlan, "network" | "signers" | "instructions">,
  attemptId: string,
  planHash: string,
  packet: PreparedPacket,
  now = Date.now(),
) {
  if (
    !packet ||
    packet.version !== 1 ||
    packet.network !== plan.network ||
    !packet.network.startsWith("solana-") ||
    packet.attemptId !== attemptId ||
    packet.planHash !== planHash ||
    !/^[a-f0-9]{64}$/.test(planHash) ||
    canonical(packet).length > 262144
  )
    throw Error("Packet does not match the immutable attempt");
  if (
    Object.keys(packet).sort().join(",") !==
    [
      "version",
      "network",
      "attemptId",
      "planHash",
      "genesisHash",
      "messageBase64",
      "messageHash",
      "lifetime",
      "lookupTables",
    ]
      .sort()
      .join(",")
  )
    throw Error("Unexpected packet fields");
  decode58(packet.genesisHash, 32);
  if (
    packet.network === "solana-mainnet" &&
    packet.genesisHash !== SOLANA_MAINNET_GENESIS
  )
    throw Error("Wrong Solana genesis identity");
  const life = packet.lifetime;
  if (
    !life ||
    life.kind !== "recent-blockhash" ||
    !Number.isSafeInteger(life.lastValidBlockHeight) ||
    life.lastValidBlockHeight < 1 ||
    !Number.isSafeInteger(life.contextSlot) ||
    life.contextSlot < 1 ||
    !Number.isSafeInteger(life.observedAt) ||
    life.observedAt > now + 1000 ||
    now - life.observedAt > 60000
  )
    throw Error("Stale or unsupported transaction lifetime");
  if (
    Object.keys(life).sort().join(",") !==
    ["kind", "blockhash", "lastValidBlockHeight", "contextSlot", "observedAt"]
      .sort()
      .join(",")
  )
    throw Error("Unexpected lifetime fields");
  decode58(life.blockhash, 32);
  if (!Array.isArray(packet.lookupTables) || packet.lookupTables.length > 8)
    throw Error("Invalid lookup evidence");
  for (const table of packet.lookupTables) {
    decode58(table.address, 32);
    if (
      Object.keys(table).sort().join(",") !==
        ["address", "contextSlot", "dataHash", "addresses"].sort().join(",") ||
      !/^[a-f0-9]{64}$/.test(table.dataHash) ||
      !Number.isSafeInteger(table.contextSlot) ||
      table.contextSlot < 1 ||
      table.contextSlot > life.contextSlot ||
      !Array.isArray(table.addresses) ||
      table.addresses.length > 256
    )
      throw Error("Invalid lookup provenance");
  }
  const bytes = messageBytes(packet.messageBase64);
  if ((await bytesHash(bytes)) !== packet.messageHash)
    throw Error("Message hash mismatch");
  const decoded = decodeMessage(bytes, packet.lookupTables);
  if (
    decoded.blockhash !== life.blockhash ||
    decoded.signers.length !== plan.signers.length ||
    decoded.signers[0] !== plan.signers[0] ||
    decoded.signers.some((s) => !plan.signers.includes(s)) ||
    decoded.instructions.length !== plan.instructions.length
  )
    throw Error("Message lifetime, signers or instructions differ");
  const privileges = new Map<string, { signer: boolean; writable: boolean }>([
    [plan.signers[0], { signer: true, writable: true }],
  ]);
  for (const ix of plan.instructions) {
    if (!privileges.has(ix.program))
      privileges.set(ix.program, { signer: false, writable: false });
    for (const a of ix.accounts) {
      const previous = privileges.get(a.address) ?? {
        signer: false,
        writable: false,
      };
      privileges.set(a.address, {
        signer: previous.signer || a.signer,
        writable: previous.writable || a.writable,
      });
    }
  }
  if (
    decoded.accounts.length !== privileges.size ||
    decoded.accounts.some(
      (a) =>
        a.signer !== privileges.get(a.address)?.signer ||
        a.writable !== privileges.get(a.address)?.writable,
    )
  )
    throw Error("Message contains unapproved accounts or privileges");
  for (let n = 0; n < decoded.instructions.length; n++) {
    const a = decoded.instructions[n],
      b = plan.instructions[n];
    if (
      a.program !== b.program ||
      a.data !== b.data ||
      a.accounts.length !== b.accounts.length ||
      a.accounts.some((k, i) => k.address !== b.accounts[i].address)
    )
      throw Error("Message instruction differs from approved plan");
  }
  return decoded;
}
