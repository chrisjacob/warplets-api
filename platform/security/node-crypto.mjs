import { createHash, createPublicKey, verify } from 'node:crypto';
import { checkedBytes } from './canonical.mjs';
import { signerKey, signatureBytes } from './ed25519.mjs';
const SPKI=Buffer.from('302a300506032b6570032100','hex');
export const sha256Sync=bytes=>createHash('sha256').update(checkedBytes(bytes)).digest('hex');
export function createNodeCrypto() {
  return Object.freeze({
    async sha256(bytes) {return sha256Sync(bytes);},
    async verifyEd25519({publicKey,signature,message}) {
      checkedBytes(message);
      try {
        const raw=signerKey(publicKey),sig=signatureBytes(signature);
        const key=createPublicKey({key:Buffer.concat([SPKI,raw]),format:'der',type:'spki'});
        return verify(null,message,key,sig);
      } catch {return false;}
    },
  });
}
