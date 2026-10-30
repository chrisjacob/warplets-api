import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { rpc } from "./safety.mjs";
export function ownershipConclusion(walletCounts, completeScope) {
  if (
    !Array.isArray(walletCounts) ||
    !walletCounts.length ||
    walletCounts.some(
      (n) => typeof n !== "string" || !/^(0|[1-9][0-9]*)$/.test(n),
    )
  )
    throw Error("Complete exact wallet balances required");
  if (walletCounts.some((n) => BigInt(n) > 0n))
    return "holder-in-supplied-wallets";
  return completeScope === true
    ? "non-holder-in-verified-scope"
    : "zero-in-supplied-wallets-full-scope-unknown";
}
/** Seven public Base calls at one finalized block. No account sign-in or writes. */
export async function observeAccounts() {
  const roster = JSON.parse(
      readFileSync(
        new URL("../fixtures/accounts.json", import.meta.url),
        "utf8",
      ),
    ),
    url = "https://mainnet.base.org";
  if ((await rpc(url, "eth_chainId")) !== "0x2105")
    throw Error("Unexpected Base chain");
  const block = await rpc(url, "eth_getBlockByNumber", ["finalized", false]);
  if (!block?.hash || !block.number)
    throw Error("Finalized Base context unavailable");
  const cases = [];
  for (const subject of roster.cases) {
    const wallets = [];
    for (const address of subject.ethereum) {
      const value = await rpc(url, "eth_call", [
        {
          to: roster.collection,
          data: "0x70a08231" + address.slice(2).padStart(64, "0"),
        },
        block.number,
      ]);
      if (!/^0x[0-9a-f]+$/i.test(value)) throw Error("Invalid ERC721 balance");
      wallets.push({ address, balance: BigInt(value).toString() });
    }
    cases.push({
      id: subject.id,
      fid: subject.fid,
      wallets,
      conclusion: ownershipConclusion(
        wallets.map((w) => w.balance),
        subject.completeLinkedWalletScope,
      ),
      farcasterLinkProof: "not-established-by-this-contract-read",
      signingExecuted: false,
      financialUseAllowed: false,
    });
  }
  const after = await rpc(url, "eth_getBlockByNumber", [block.number, false]);
  if (after.hash !== block.hash) throw Error("Base context changed");
  return {
    version: 1,
    asOf: new Date().toISOString(),
    network: "base-mainnet",
    collection: roster.collection,
    blockNumber: BigInt(block.number).toString(),
    blockHash: block.hash,
    requests: 7,
    cases,
    historyCoverage: "not-certified",
    accountChanges: false,
    financialTransactions: false,
  };
}
if (process.argv[1]?.endsWith("accounts.mjs")) {
  if (process.argv[2] !== "--public-read-only" || !process.argv[3])
    throw Error("Usage: accounts --public-read-only <ignored-output-file>");
  const report = await observeAccounts(),
    output = resolve(process.argv[3]);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
