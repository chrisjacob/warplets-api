import { PublicKey } from "@solana/web3.js";
const key = (n) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();
// Arithmetic/instruction fixture only. These prices, fee settings and public keys are NOT policy.
export const fixture = {
  simulated: true,
  tokenProgram: "spl-token",
  permanentLock: true,
  totalSupply: "1000000000000000000",
  editionDecimals: 9,
  ogDecimals: 9,
  editionMint: key(2),
  ogMint: key(3),
  creator: key(4),
  payer: key(4),
  positionNft: key(5),
  minimumOgPrice: "0.000001",
  maximumOgPrice: "0.001",
  activationUnixSeconds: 1800000000,
  fees: {
    openingBps: 1000,
    ongoingBps: 100,
    durationSeconds: 600,
    periods: 600,
  },
};
