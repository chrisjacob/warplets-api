import type {CanonicalCrypto} from '../application/ports';
export interface PinnedBeaconProof{readonly chain:string;readonly round:number;readonly randomness:string;readonly signature:string}
export interface PinnedBeaconVerifier{verifyShortSignature(input:{signature:Uint8Array;message:Uint8Array;publicKey:Uint8Array;dst:string}):boolean|Promise<boolean>}
export function verifyPinnedBeacon(proof:PinnedBeaconProof,expectedRound:number,crypto:CanonicalCrypto,verifier:PinnedBeaconVerifier):Promise<string>;
