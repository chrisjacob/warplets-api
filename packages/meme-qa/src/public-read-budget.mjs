/** One shared overnight allowance. No secret, signer or broadcast method is accepted. */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const base = new Set([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_call",
  "eth_getLogs",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_getBalance",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_estimateGas",
]);
const solana = new Set([
  "getGenesisHash",
  "getSlot",
  "getBlockHeight",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getTransaction",
  "getSignaturesForAddress",
  "getMultipleAccounts",
  "getAccountInfo",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
  "isBlockhashValid",
  "simulateTransaction",
]);
let sharedPath;
function ledgerPath() {
  if (!sharedPath) {
    const root = resolve(import.meta.dirname, "../../..");
    const common = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: root, encoding: "utf8", windowsHide: true },
    ).trim();
    sharedPath = resolve(
      dirname(common),
      ".tmp/launchpad-public-reads-2026-10-31.json",
    );
  }
  return sharedPath;
}
export function reservePublicRead(url, method, params = [], options = {}) {
  const u = new URL(url);
  const methods =
    u.href === "https://mainnet.base.org/"
      ? base
      : u.href === "https://api.mainnet-beta.solana.com/"
        ? solana
        : null;
  if (!methods?.has(method))
    throw Error("Unapproved public RPC endpoint or method");
  if (!options.path && process.env.MEME_PUBLIC_READ_APPROVAL !== "2026-10-31")
    throw Error("Explicit overnight public-read approval context required");
  const path = options.path ?? ledgerPath(),
    limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw Error("Read limit cannot exceed approved allowance");
  mkdirSync(dirname(path), { recursive: true });
  const lock = openSync(path + ".lock", "wx");
  try {
    const ledger = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : { version: 1, approval: "2026-10-31", limit, used: 0, attempts: [] };
    if (
      ledger.version !== 1 ||
      ledger.approval !== "2026-10-31" ||
      ledger.limit !== limit ||
      !Number.isSafeInteger(ledger.used) ||
      ledger.used < 0 ||
      !Array.isArray(ledger.attempts) ||
      ledger.used !== ledger.attempts.length
    )
      throw Error("Invalid read ledger; refusing reset");
    if (ledger.used >= limit)
      throw Error("Approved public-read allowance exhausted");
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ url: u.href, method, params }))
      .digest("hex");
    ledger.attempts.push({
      ordinal: ++ledger.used,
      at: new Date().toISOString(),
      endpoint: u.origin,
      method,
      requestHash,
    });
    const temporary = path + "." + process.pid + ".tmp",
      fd = openSync(temporary, "wx");
    try {
      writeFileSync(fd, JSON.stringify(ledger, null, 2) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
    return { used: ledger.used, remaining: limit - ledger.used };
  } finally {
    closeSync(lock);
    unlinkSync(path + ".lock");
  }
}
