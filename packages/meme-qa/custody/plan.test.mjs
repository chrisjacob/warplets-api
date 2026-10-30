import test from "node:test";
import assert from "node:assert/strict";
import * as multisig from "@sqds/multisig";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  TransactionMessage,
} from "@solana/web3.js";
test("pinned multisig SDK compiles distinct three-member custody and a vault-signed message without RPC", () => {
  const keys = Array.from({ length: 3 }, () => Keypair.generate()),
    createKey = Keypair.generate(),
    [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey }),
    [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  const ix = multisig.instructions.multisigCreateV2({
    treasury: keys[0].publicKey,
    creator: keys[0].publicKey,
    createKey: createKey.publicKey,
    multisigPda,
    configAuthority: null,
    threshold: 2,
    members: keys.map((k) => ({
      key: k.publicKey,
      permissions: multisig.types.Permissions.all(),
    })),
    timeLock: 3600,
    rentCollector: keys[0].publicKey,
  });
  assert(
    ix.programId.equals(
      new PublicKey("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"),
    ),
  );
  assert(
    ix.keys.some((k) => k.pubkey.equals(createKey.publicKey) && k.isSigner),
  );
  const message = new TransactionMessage({
    payerKey: vault,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: [
      SystemProgram.transfer({
        fromPubkey: vault,
        toPubkey: keys[2].publicKey,
        lamports: 1,
      }),
    ],
  });
  assert(
    multisig.instructions.vaultTransactionCreate({
      multisigPda,
      transactionIndex: 1n,
      creator: keys[0].publicKey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage: message,
    }).data.length > 0,
  );
  assert.equal(
    multisig.accounts.ProgramConfig.fromArgs({
      authority: keys[0].publicKey,
      multisigCreationFee: 0n,
      treasury: keys[0].publicKey,
      reserved: Array(64).fill(0),
    }).serialize()[0].length,
    144,
  );
});
