import {decode58} from '../server/base58.mjs';

const field=(1n<<255n)-19n;
const order=(1n<<252n)+27742317777372353535851937790883648493n;
// Low-order compressed y coordinates, independent of x sign. Reference:
// https://github.com/jedisct1/libsodium/blob/1.0.18/src/libsodium/crypto_core/ed25519/ref10/ed25519_ref10.c#L965
const small=new Set([0n,1n,field-1n,
  2707385501144840649318225287225658788936804267575313519463743609750303402022n,
  55188659117513257062467267217118295137698188065244968500265048394206261417927n]);
function littleEndian(bytes){
 let value=0n;
 for(let i=bytes.length-1;i>=0;i--)value=(value<<8n)|BigInt(bytes[i]);
 return value;
}
function strictPoint(bytes){
 const y=littleEndian(bytes)&((1n<<255n)-1n);
 if(y>=field||small.has(y))throw Error('Invalid Ed25519 point encoding.');
}
// Runtime crypto still verifies the Ed25519 equation. Reject weak and alternate encodings at this boundary.
export function signerKey(value){
 const bytes=decode58(value,32);strictPoint(bytes);return bytes;
}
export function signatureBytes(value){
 const bytes=decode58(value,64);
 try{strictPoint(bytes.subarray(0,32));}catch{throw Error('Invalid Ed25519 signature point.');}
 if(littleEndian(bytes.subarray(32))>=order)throw Error('Invalid Ed25519 signature scalar.');
 return bytes;
}
