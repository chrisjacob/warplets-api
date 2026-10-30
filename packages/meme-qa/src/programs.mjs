import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { PublicKey } from "@solana/web3.js";
import { hash, validateEvidenceCapture, loopback } from "./safety.mjs";
export function loadPrograms() {
  const pin = JSON.parse(
    readFileSync(new URL("../fixtures/programs.json", import.meta.url), "utf8"),
  );
  const compressed = readFileSync(
    new URL("../fixtures/programs-mainnet.json.gz", import.meta.url),
  );
  if (hash(compressed) !== pin.captureSha256)
    throw Error("Captured program archive checksum mismatch");
  const capture = validateEvidenceCapture(
    JSON.parse(gunzipSync(compressed, { maxOutputLength: 16 * 1024 * 1024 })),
  );
  return pin.programs.map((expected) => {
    const p = capture.accounts.find((a) => a.address === expected.address),
      d = capture.accounts.find((a) => a.address === p?.programData);
    if (
      !p?.executable ||
      !d ||
      hash(Buffer.from(d.data, "base64").subarray(45)) !==
        expected.binarySha256 ||
      p.upgradeAuthority !== expected.upgradeAuthority
    )
      throw Error("Program hash or authority differs from reviewed fixture");
    const data = Buffer.from(d.data, "base64");
    if (
      new PublicKey(
        Buffer.from(p.data, "base64").subarray(4, 36),
      ).toBase58() !== d.address ||
      data.readUInt32LE() !== 3
    )
      throw Error("Invalid captured program linkage");
    return {
      ...expected,
      bytes: data.subarray(45),
      context: capture.context,
      capturedAt: capture.capturedAt,
      sourceCodeMatchVerified: false,
    };
  });
}
export function installPrograms(net) {
  loopback(net.rpcUrl);
  const programs = loadPrograms();
  for (const p of programs)
    net.deploy({ programId: p.address, soBytes: p.bytes });
  return programs.map(({ bytes, ...p }) => p);
}
