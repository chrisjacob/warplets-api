import { checkedBytes, hex } from './canonical.mjs';
import { signerKey, signatureBytes } from './ed25519.mjs';
export function createWebCrypto(runtime=globalThis.crypto) {
  if(!runtime?.subtle)throw new TypeError('WebCrypto is required.');
  return Object.freeze({
    async sha256(bytes) {
      return hex(new Uint8Array(await runtime.subtle.digest('SHA-256',new Uint8Array(checkedBytes(bytes)))));
    },
    async verifyEd25519({publicKey,signature,message}) {
      checkedBytes(message);
      try {
        const raw=new Uint8Array(signerKey(publicKey)),sig=new Uint8Array(signatureBytes(signature));
        const key=await runtime.subtle.importKey('raw',raw,'Ed25519',false,['verify']);
        return await runtime.subtle.verify('Ed25519',key,sig,new Uint8Array(message));
      } catch {return false;}
    },
  });
}
