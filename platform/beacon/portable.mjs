import {captureBeaconProof,hexBytes,beaconRoundBytes,QUICKNET_PUBLIC_KEY,QUICKNET_DST} from './protocol.mjs';
/** The injected verifier is a trusted application adapter, never request data.
 * This module imports no optional package, Node crypto or browser globals. */
export async function verifyPinnedBeacon(value,expectedRound,crypto,verifier){
 const proof=captureBeaconProof(value,expectedRound),signature=hexBytes(proof.signature),roundBytes=beaconRoundBytes(expectedRound);
 if(typeof verifier?.verifyShortSignature!=='function')throw Error('Pinned beacon verifier unavailable.');
 if(await crypto.sha256(signature)!==proof.randomness)throw Error('Beacon entropy does not match its signature.');
 const message=hexBytes(await crypto.sha256(roundBytes));
 if(await verifier.verifyShortSignature({signature,message,publicKey:hexBytes(QUICKNET_PUBLIC_KEY),dst:QUICKNET_DST})!==true)throw Error('Beacon signature verification failed.');
 return proof.randomness;
}
