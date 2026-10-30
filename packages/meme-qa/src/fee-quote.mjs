import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { rpc } from "./safety.mjs";
import { estimateBudget } from "./budget.mjs";
const url = "https://api.mainnet-beta.solana.com";
/** Four public read-only calls. No signer or transaction broadcast exists here. */
export async function referenceFees(address) {
  const payer = new PublicKey(address);
  const mintRent = await rpc(url, "getMinimumBalanceForRentExemption", [
    82,
    { commitment: "finalized" },
  ]);
  const tokenAccountRent = await rpc(url, "getMinimumBalanceForRentExemption", [
    165,
    { commitment: "finalized" },
  ]);
  const block = await rpc(url, "getLatestBlockhash", [
    { commitment: "finalized" },
  ]);
  const tx = new Transaction({
    feePayer: payer,
    recentBlockhash: block.value.blockhash,
  }).add(
    SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 }),
  );
  const fee = await rpc(url, "getFeeForMessage", [
    tx.compileMessage().serialize().toString("base64"),
    { commitment: "finalized" },
  ]);
  if (
    !Number.isSafeInteger(fee.value) ||
    !Number.isSafeInteger(mintRent) ||
    !Number.isSafeInteger(tokenAccountRent)
  )
    throw Error("Exact reference fee unavailable");
  return {
    version: 1,
    asOf: new Date().toISOString(),
    source: "Solana public mainnet finalized RPC",
    context: fee.context.slot,
    requests: 4,
    status: "reference-only-not-a-launch-budget",
    identitySigning: { baseWei: "0", solanaLamports: "0" },
    reference: {
      oneSignatureBaseFeeLamports: String(fee.value),
      mint82ByteRentLamports: String(mintRent),
      tokenAccount165ByteRentLamports: String(tokenAccountRent),
    },
    example: estimateBudget({
      solana: [
        {
          label: "One-signature zero-priority transaction",
          units: String(fee.value),
        },
        { label: "One standard SPL mint rent", units: String(mintRent) },
        {
          label: "One standard SPL token account rent",
          units: String(tokenAccountRent),
        },
      ],
    }),
    remaining: [
      "Exact transaction list and simulation",
      "Live Base execution/L1 fee if a Base write is proposed",
      "Priority fee policy",
      "Actual program account sizes/rents",
      "Pool creation fees",
      "Chosen OG mint and one raw OG unit",
      "Human funding approval and wallet confirmation",
    ],
    fundingRequested: false,
    mainnetWrites: false,
  };
}
if (process.argv[1]?.endsWith("fee-quote.mjs")) {
  const [mode, address, output] = process.argv.slice(2);
  if (mode !== "--public-read-only" || !address || !output)
    throw Error(
      "Usage: fee-quote --public-read-only <Solana-QA-public-address> <ignored-output-file>",
    );
  const quote = await referenceFees(address);
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, JSON.stringify(quote, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(quote, null, 2));
}
