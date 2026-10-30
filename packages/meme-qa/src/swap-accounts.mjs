/** Narrow local SDK adapter: remove only redundant idempotent creates after independently verifying both existing ATAs. */
import { PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  unpackAccount,
} from "@solana/spl-token";
import { loopback } from "./safety.mjs";
export async function existingSwapInstructions(
  connection,
  instructions,
  wallet,
  inputMint,
  outputMint,
  minContextSlot,
) {
  loopback(connection.rpcEndpoint);
  const expected = [];
  for (const mint of [inputMint, outputMint]) {
    const ata = getAssociatedTokenAddressSync(mint, wallet),
      record = await connection.getAccountInfoAndContext(ata, {
        commitment: "finalized",
        minContextSlot,
      });
    if (!record.value || record.context.slot < minContextSlot)
      throw Error("Existing swap account coverage unavailable");
    const account = unpackAccount(ata, record.value, TOKEN_PROGRAM_ID);
    if (
      !account.isInitialized ||
      !account.owner.equals(wallet) ||
      !account.mint.equals(mint) ||
      account.isFrozen
    )
      throw Error("Existing swap account has incompatible owner/mint/state");
    expected.push(
      createAssociatedTokenAccountIdempotentInstruction(
        wallet,
        ata,
        wallet,
        mint,
        TOKEN_PROGRAM_ID,
      ),
    );
  }
  return instructions.filter((ix) => {
    if (!ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) return true;
    if (
      !expected.some(
        (e) =>
          e.data.equals(ix.data) &&
          e.keys.length === ix.keys.length &&
          e.keys.every(
            (k, i) =>
              k.pubkey.equals(ix.keys[i].pubkey) &&
              k.isSigner === ix.keys[i].isSigner &&
              k.isWritable === ix.keys[i].isWritable,
          ),
      )
    )
      throw Error("SDK inserted an unapproved account creation");
    return false;
  });
}
