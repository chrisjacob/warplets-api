import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { rpc, hash, validateEvidenceCapture } from "./safety.mjs";
const launchPrograms = [
  "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  "mERKcfxMC5SqJn4Ld4BUris3WKZZ1ojjWJ3A3J5CKxv",
];
/** Two bounded, public read-only RPC requests; never uses Network credentials. */
export async function capturePrograms(output, selection = "launch") {
  if (!["launch", "custody"].includes(selection))
    throw Error("Unsupported capture selection");
  const programs =
    selection === "launch"
      ? launchPrograms
      : ["SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"];
  const endpoint = "https://api.mainnet-beta.solana.com";
  const first = await rpc(endpoint, "getMultipleAccounts", [
    programs,
    { encoding: "base64", commitment: "finalized" },
  ]);
  const dataAddresses = first.value.map((a, index) => {
    if (
      !a?.executable ||
      a.owner !== "BPFLoaderUpgradeab1e11111111111111111111111"
    )
      throw Error("Unexpected upgradeable program: " + programs[index]);
    const b = Buffer.from(a.data[0], "base64");
    if (b.readUInt32LE() !== 2) throw Error("Unexpected program layout");
    return new PublicKey(b.subarray(4, 36)).toBase58();
  });
  const addresses = [...programs, ...dataAddresses];
  const result = await rpc(endpoint, "getMultipleAccounts", [
    addresses,
    {
      encoding: "base64",
      commitment: "finalized",
      minContextSlot: first.context.slot,
    },
  ]);
  const accounts = result.value.map((a, i) => {
    if (!a) throw Error("Missing program dependency");
    return {
      address: addresses[i],
      owner: a.owner,
      executable: a.executable,
      lamports: String(a.lamports),
      data: a.data[0],
      sha256: hash(Buffer.from(a.data[0], "base64")),
    };
  });
  const manifest = validateEvidenceCapture({
    version: 1,
    network: "solana-mainnet",
    context: result.context.slot,
    capturedAt: new Date().toISOString(),
    source: "Solana public mainnet RPC; finalized getMultipleAccounts",
    requests: 2,
    sourceCodeMatchVerified: false,
    accounts,
  });
  for (let i = 0; i < programs.length; i++) {
    const p = Buffer.from(accounts[i].data, "base64"),
      d = Buffer.from(accounts[i + programs.length].data, "base64");
    if (
      new PublicKey(p.subarray(4, 36)).toBase58() !== dataAddresses[i] ||
      d.readUInt32LE() !== 3 ||
      accounts[i + programs.length].owner !==
        "BPFLoaderUpgradeab1e11111111111111111111111"
    )
      throw Error("Program linkage changed or invalid program data");
    accounts[i].programData = dataAddresses[i];
    accounts[i].upgradeAuthority =
      d[12] === 1 ? new PublicKey(d.subarray(13, 45)).toBase58() : null;
    accounts[i].deployedSlot = d.readBigUInt64LE(4).toString();
    accounts[i].binarySha256 = hash(d.subarray(45));
  }
  mkdirSync(output, { recursive: true });
  writeFileSync(
    resolve(output, "mainnet-programs.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  return {
    network: manifest.network,
    context: manifest.context,
    requests: manifest.requests,
    programs: accounts
      .slice(0, programs.length)
      .map(({ address, binarySha256, upgradeAuthority, deployedSlot }) => ({
        address,
        binarySha256,
        upgradeAuthority,
        deployedSlot,
      })),
    sourceCodeMatchVerified: false,
  };
}
if (process.argv[1]?.endsWith("capture.mjs")) {
  if (
    !["--public-read-only", "--custody-read-only"].includes(process.argv[2]) ||
    !process.argv[3]
  )
    throw Error(
      "Usage: capture --public-read-only <ignored-output-directory>; writes no chain state",
    );
  console.log(
    JSON.stringify(
      await capturePrograms(
        resolve(process.argv[3]),
        process.argv[2] === "--custody-read-only" ? "custody" : "launch",
      ),
      null,
      2,
    ),
  );
}
