/** Resumable ownerOf reconciliation at one finalized Base block. Never updates the source DB. */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rpc, hash } from "./safety.mjs";
const endpoint = "https://mainnet.base.org",
  collection = "0x780446dd12e080ae0db762fcd4daf313f3e359de";
function save(path, state) {
  const bytes = JSON.stringify(state);
  const envelope = { state, sha256: hash(bytes) };
  const temporary = path + "." + process.pid + ".tmp";
  writeFileSync(temporary, JSON.stringify(envelope, null, 2) + "\n", {
    flag: "wx",
  });
  renameSync(temporary, path);
}
function validBlock(block) {
  if (
    !block ||
    !/^0x[0-9a-f]{64}$/i.test(block.hash) ||
    !/^0x[0-9a-f]+$/i.test(block.number) ||
    !/^0x[0-9a-f]+$/i.test(block.timestamp)
  )
    throw Error("Finalized Base context unavailable");
  return block;
}
export function loadOwnershipCheckpoint(path) {
  const envelope = JSON.parse(readFileSync(path, "utf8")),
    s = envelope.state;
  if (
    !s ||
    envelope.sha256 !== hash(JSON.stringify(s)) ||
    s.version !== 1 ||
    s.chainId !== 8453 ||
    s.collection !== collection ||
    !Array.isArray(s.records) ||
    s.records.length > 10000
  )
    throw Error("Invalid ownership checkpoint");
  validBlock(s.block);
  for (let i = 0; i < s.records.length; i++)
    if (
      s.records[i].tokenId !== i + 1 ||
      !/^0x[0-9a-f]{40}$/.test(s.records[i].wallet) ||
      !/^0x0{24}[0-9a-f]{40}$/.test(s.records[i].callResult) ||
      s.records[i].wallet !== "0x" + s.records[i].callResult.slice(-40)
    )
      throw Error("Invalid ownership record sequence");
  if (
    s.complete !== (s.records.length === 10000) ||
    s.chainSnapshotVerified !== s.complete ||
    s.metadataBound !== false ||
    s.financialFreezeEligible !== false ||
    s.asOf !== Number(BigInt(s.block.timestamp)) * 1000 ||
    !Number.isSafeInteger(s.observedAt) ||
    s.observedAt < s.asOf
  )
    throw Error("Invalid ownership coverage flag");
  return s;
}
export async function startOwnershipCheckpoint(
  path,
  { request = rpc, now = Date.now } = {},
) {
  mkdirSync(dirname(path), { recursive: true });
  const lock = openSync(path + ".lock", "wx");
  try {
    if (existsSync(path)) throw Error("Checkpoint exists; resume it instead");
    if ((await request(endpoint, "eth_chainId")) !== "0x2105")
      throw Error("Unexpected Base chain");
    const block = validBlock(
      await request(endpoint, "eth_getBlockByNumber", ["finalized", false]),
    );
    const asOf = Number(BigInt(block.timestamp)) * 1000;
    if (!Number.isSafeInteger(asOf) || asOf <= 0 || asOf > now())
      throw Error("Invalid Base block time");
    const state = {
      version: 1,
      chainId: 8453,
      collection,
      block,
      asOf,
      observedAt: now(),
      records: [],
      complete: false,
      chainSnapshotVerified: false,
      metadataBound: false,
      financialFreezeEligible: false,
    };
    save(path, state);
    return state;
  } finally {
    closeSync(lock);
    unlinkSync(path + ".lock");
  }
}
export async function stepOwnershipCheckpoint(
  path,
  { request = rpc, limit = 20, now = Date.now } = {},
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    throw Error("Ownership step must contain 1–20 calls");
  const lock = openSync(path + ".lock", "wx");
  try {
    const state = loadOwnershipCheckpoint(path);
    if (state.complete) return state;
    const current = validBlock(
      await request(endpoint, "eth_getBlockByNumber", [
        state.block.number,
        false,
      ]),
    );
    if (current.hash !== state.block.hash)
      throw Error("Pinned ownership block is no longer canonical");
    const end = Math.min(10000, state.records.length + limit);
    while (state.records.length < end) {
      const tokenId = state.records.length + 1;
      const result = await request(endpoint, "eth_call", [
        {
          to: collection,
          data: "0x6352211e" + BigInt(tokenId).toString(16).padStart(64, "0"),
        },
        { blockHash: state.block.hash, requireCanonical: true },
      ]);
      if (
        typeof result !== "string" ||
        !/^0x0{24}[0-9a-f]{40}$/i.test(result) ||
        /^0x0{64}$/i.test(result)
      )
        throw Error("Owner result is missing, reverted or invalid");
      state.records.push({
        tokenId,
        wallet: "0x" + result.slice(-40).toLowerCase(),
        callResult: result.toLowerCase(),
      });
      state.observedAt = now();
      // Save each accepted read; an outage or exhausted global allowance preserves the cursor.
      if (state.records.length === 10000) {
        state.complete = true;
        state.chainSnapshotVerified = true;
      }
      save(path, state);
    }
    return state;
  } finally {
    closeSync(lock);
    unlinkSync(path + ".lock");
  }
}
export function ownershipCoverage(state, cachedOwners = []) {
  const cached = new Map(
    cachedOwners.map((r) => [r.tokenId, String(r.wallet).toLowerCase()]),
  );
  return {
    version: 1,
    chainId: 8453,
    block: state.block.number,
    blockHash: state.block.hash,
    asOf: state.asOf,
    observedAt: state.observedAt,
    checked: state.records.length,
    required: 10000,
    unresolved: 10000 - state.records.length,
    mismatches: state.records.filter(
      (r) => cached.has(r.tokenId) && cached.get(r.tokenId) !== r.wallet,
    ),
    complete: state.complete,
    chainSnapshotVerified: state.complete,
    metadataBound: false,
    financialFreezeEligible: false,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [action, path] = process.argv.slice(2);
  if (!path || !["start", "step", "status"].includes(action))
    throw Error(
      "Use ownership-checkpoint start|step|status <ignored-checkpoint-path>",
    );
  const state =
    action === "start"
      ? await startOwnershipCheckpoint(resolve(path))
      : action === "step"
        ? await stepOwnershipCheckpoint(resolve(path))
        : loadOwnershipCheckpoint(resolve(path));
  console.log(JSON.stringify(ownershipCoverage(state), null, 2));
}
