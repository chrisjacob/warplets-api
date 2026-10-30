import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { resolve, dirname, parse, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export function createWalletMaterial() {
  const solana = Keypair.generate(),
    basePrivateKey = generatePrivateKey();
  return {
    version: 1,
    basePrivateKey,
    solanaSecretKey: Buffer.from(solana.secretKey).toString("base64"),
  };
}
export function publicWallets(material) {
  if (material.version !== 1) throw Error("Unsupported wallet vault");
  return {
    base: privateKeyToAccount(material.basePrivateKey).address,
    solana: Keypair.fromSecretKey(
      Buffer.from(material.solanaSecretKey, "base64"),
    ).publicKey.toBase58(),
  };
}
function dpapi(action, input) {
  if (process.platform !== "win32")
    throw Error(
      "Fundable QA vaults require Windows CurrentUser DPAPI; no plaintext fallback",
    );
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      fileURLToPath(new URL("./dpapi.ps1", import.meta.url)),
      action,
    ],
    { input, encoding: "utf8", windowsHide: true, maxBuffer: 16384 },
  );
  if (result.status !== 0 || !result.stdout)
    throw Error("Windows wallet protection failed; no secret details logged");
  return result.stdout;
}
export function requireOutsideRepository(directory) {
  const absolute = resolve(directory);
  let cursor = absolute;
  while (cursor !== parse(cursor).root) {
    if (existsSync(resolve(cursor, ".git")))
      throw Error("Wallet vault must be outside every Git worktree");
    cursor = dirname(cursor);
  }
  return absolute;
}
export function initializeVault(directory) {
  const target = requireOutsideRepository(directory);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  requireOutsideRepository(realpathSync(target));
  const vault = resolve(target, "wallets.dpapi"),
    backup = resolve(target, "wallets.backup.dpapi");
  if (existsSync(vault) || existsSync(backup))
    throw Error("Vault exists; refusing to replace QA keys");
  const material = createWalletMaterial(),
    addresses = publicWallets(material);
  const ciphertext = dpapi("protect", JSON.stringify(material));
  writeFileSync(vault, ciphertext, { flag: "wx", mode: 0o600 });
  copyFileSync(vault, backup, 1);
  const restored = publicWallets(
    JSON.parse(dpapi("unprotect", readFileSync(backup, "utf8"))),
  );
  if (JSON.stringify(restored) !== JSON.stringify(addresses))
    throw Error("Backup restoration differs; do not fund");
  const manifest = {
    version: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    addresses,
    networks: { base: 8453, solana: "mainnet-beta" },
    protection: "Windows DPAPI CurrentUser",
    encryptedBackupSha256: createHash("sha256")
      .update(readFileSync(backup))
      .digest("hex"),
    sameProfileRestoreVerified: true,
    portableRecoveryVerified: false,
    fundingApproved: false,
  };
  writeFileSync(
    resolve(target, "public-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return manifest;
}
export function verifyVault(directory) {
  const target = requireOutsideRepository(directory),
    manifest = JSON.parse(
      readFileSync(resolve(target, "public-manifest.json"), "utf8"),
    );
  for (const name of ["wallets.dpapi", "wallets.backup.dpapi"]) {
    const restored = publicWallets(
      JSON.parse(
        dpapi("unprotect", readFileSync(resolve(target, name), "utf8")),
      ),
    );
    if (JSON.stringify(restored) !== JSON.stringify(manifest.addresses))
      throw Error("Wallet restore mismatch; do not fund");
  }
  if (
    createHash("sha256")
      .update(readFileSync(resolve(target, "wallets.backup.dpapi")))
      .digest("hex") !== manifest.encryptedBackupSha256
  )
    throw Error("Backup checksum mismatch");
  return {
    addresses: manifest.addresses,
    sameProfileRestoreVerified: true,
    portableRecoveryVerified: manifest.portableRecoveryVerified,
    fundingApproved: false,
  };
}
if (
  process.argv[1] &&
  relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === ""
) {
  const [command, directory] = process.argv.slice(2);
  if (!directory || !["init", "verify"].includes(command))
    throw Error("Usage: wallets init|verify <directory-outside-git>");
  console.log(
    JSON.stringify(
      command === "init" ? initializeVault(directory) : verifyVault(directory),
      null,
      2,
    ),
  );
}
