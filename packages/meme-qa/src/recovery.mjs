import {
  scryptSync,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "node:crypto";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  publicWallets,
  requireOutsideRepository,
  readProtectedMaterial,
  protectWalletMaterial,
} from "./wallets.mjs";

const aad = Buffer.from("10x-qa-portable-v1");
function key(passphrase, salt) {
  if (
    typeof passphrase !== "string" ||
    passphrase.length < 20 ||
    passphrase.length > 1024
  )
    throw Error("Use a unique passphrase of at least 20 characters");
  return scryptSync(passphrase, salt, 32, {
    N: 131072,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
}
export function encryptRecovery(material, passphrase) {
  const salt = randomBytes(32),
    iv = randomBytes(12),
    derived = key(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", derived, iv);
  cipher.setAAD(aad);
  const plaintext = Buffer.from(JSON.stringify(material));
  try {
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return {
      version: 1,
      kdf: "scrypt-131072-8-1",
      cipher: "aes-256-gcm",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  } finally {
    derived.fill(0);
    plaintext.fill(0);
  }
}
export function decryptRecovery(envelope, passphrase) {
  const e = envelope;
  if (
    !e ||
    e.version !== 1 ||
    e.kdf !== "scrypt-131072-8-1" ||
    e.cipher !== "aes-256-gcm" ||
    [e.salt, e.iv, e.tag, e.ciphertext].some(
      (x) => typeof x !== "string" || x.length > 16384,
    ) ||
    Buffer.from(e.salt, "base64").length !== 32 ||
    Buffer.from(e.iv, "base64").length !== 12 ||
    Buffer.from(e.tag, "base64").length !== 16
  )
    throw Error("Unsupported or malformed recovery envelope");
  const derived = key(passphrase, Buffer.from(e.salt, "base64"));
  let plaintext;
  try {
    const cipher = createDecipheriv(
      "aes-256-gcm",
      derived,
      Buffer.from(e.iv, "base64"),
    );
    cipher.setAAD(aad);
    cipher.setAuthTag(Buffer.from(e.tag, "base64"));
    plaintext = Buffer.concat([
      cipher.update(Buffer.from(e.ciphertext, "base64")),
      cipher.final(),
    ]);
    const material = JSON.parse(plaintext.toString());
    publicWallets(material);
    return material;
  } catch {
    throw Error("Recovery failed: incorrect passphrase or altered backup");
  } finally {
    derived.fill(0);
    plaintext?.fill(0);
  }
}
if (
  process.argv[1] &&
  relative(resolve(process.argv[1]), fileURLToPath(import.meta.url)) === ""
) {
  const [command, directory, destination] = process.argv.slice(2);
  const target = requireOutsideRepository(
    realpathSync(requireOutsideRepository(directory)),
  );
  const input = readFileSync(0, "utf8");
  const { passphrase } = JSON.parse(input);
  const file = resolve(target, "wallets.portable.encrypted.json");
  if (command === "backup") {
    const material = readProtectedMaterial(target);
    const envelope = encryptRecovery(material, passphrase);
    if (
      JSON.stringify(publicWallets(decryptRecovery(envelope, passphrase))) !==
      JSON.stringify(publicWallets(material))
    )
      throw Error("Portable restore mismatch");
    writeFileSync(file, JSON.stringify(envelope), { flag: "wx", mode: 0o600 });
    console.log(
      JSON.stringify({
        addresses: publicWallets(material),
        encryptedSha256: createHash("sha256")
          .update(readFileSync(file))
          .digest("hex"),
        portableCryptographicRestoreVerified: true,
        ownerWalletImportVerified: false,
        fundingApproved: false,
      }),
    );
  } else if (["verify", "restore"].includes(command)) {
    const material = decryptRecovery(
      JSON.parse(readFileSync(file, "utf8")),
      passphrase,
    );
    const expected = JSON.parse(
      readFileSync(resolve(target, "public-manifest.json"), "utf8"),
    ).addresses;
    if (JSON.stringify(publicWallets(material)) !== JSON.stringify(expected))
      throw Error("Recovery addresses differ");
    if (command === "restore") protectWalletMaterial(destination, material);
    console.log(
      JSON.stringify({
        addresses: expected,
        portableCryptographicRestoreVerified: true,
        ownerWalletImportVerified: false,
        fundingApproved: false,
      }),
    );
  } else
    throw Error("Use the owner-operated recovery.ps1 backup|verify command");
}
