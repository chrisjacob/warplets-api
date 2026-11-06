// Optional pinned adapter: imported only by beacon/Worker acceptance and explicit
// application composition, never by the dependency-free reference harness.
import {bls12_381} from '@noble/curves/bls12-381.js';
export function createNobleBeaconVerifier(){return Object.freeze({verifyShortSignature({signature,message,publicKey,dst}){const suite=bls12_381.shortSignatures;return suite.verify(signature,suite.hash(message,dst),publicKey);}});}
