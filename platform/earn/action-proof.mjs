import {canonicalJson,utf8} from '../security/canonical.mjs';
import {signerKey,signatureBytes} from '../security/ed25519.mjs';
import {epochAt} from '../domain/earn/index.mjs';
import {name,nat,requireValue} from './validation.mjs';
export const PROOF_DOMAIN='10x.local.earn-action.v1';
const signedFields=['domain','issuerId','grantRevision','actionId','wallet','nonce','issuedAtMs','expiresMs','sourceHash'];
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function capture(value){
 try{return JSON.parse(canonicalJson(value));}catch{requireValue(false,'Invalid action proof input.');}
}
function checkedKey(value){
 try{requireValue(typeof value==='string','Invalid issuer Ed25519 public key.');signerKey(value);}
 catch{requireValue(false,'Invalid issuer Ed25519 public key.');}
}
function checkedSignature(value){
 try{requireValue(typeof value==='string','Invalid Ed25519 signature bytes.');signatureBytes(value);}
 catch{requireValue(false,'Invalid Ed25519 signature bytes.');}
}
function base64(bytes){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';let result='';
 for(let i=0;i<bytes.length;i+=3){
  const a=bytes[i],b=bytes[i+1],c=bytes[i+2];
  result+=alphabet[a>>2]+alphabet[((a&3)<<4)|((b??0)>>4)]+(b===undefined?'=':alphabet[((b&15)<<2)|((c??0)>>6)])+(c===undefined?'=':alphabet[c&63]);
 }return result;
}
// This field order is the existing signed protocol, not canonical object JSON.
export function signedCompletionBytes(proof){
 requireValue(proof&&typeof proof==='object'&&!Array.isArray(proof)&&Object.keys(proof).length===signedFields.length&&signedFields.every(k=>Object.hasOwn(proof,k)),'Unexpected proof fields.');
 requireValue(proof.domain===PROOF_DOMAIN,'Wrong action-proof domain.');
 for(const key of ['issuerId','actionId','wallet'])name(proof[key],key);
 checkedKey(proof.wallet);
 requireValue(typeof proof.nonce==='string'&&/^[A-Za-z0-9_-]{16,96}$/.test(proof.nonce),'Invalid one-use nonce.');
 requireValue(digest(proof.grantRevision)&&digest(proof.sourceHash),'Expected SHA-256 references.');
 nat(proof.issuedAtMs,'issue time');nat(proof.expiresMs,'expiry');
 requireValue(proof.expiresMs>proof.issuedAtMs&&proof.expiresMs-proof.issuedAtMs<=600000,'Proof lifetime is at most ten minutes.');
 return utf8(JSON.stringify(signedFields.map(k=>proof[k])));
}
function prepare(value){
 const input=capture(value),{wallet,actionId,proof,signature}=input,message=signedCompletionBytes(proof);
 name(wallet,'wallet');name(actionId,'action ID');
 requireValue(proof.wallet===wallet&&proof.actionId===actionId,'Proof does not belong to this wallet and action.');
 checkedSignature(signature);
 return {input,message};
}
async function identity(input,message,crypto){
 const {wallet,actionId,proof,signature}=input;
 const proofDigest=await crypto.sha256(utf8(JSON.stringify([PROOF_DOMAIN,base64(message),signature])));
 return {issuerId:proof.issuerId,nonce:proof.nonce,wallet,actionId,sourceHash:proof.sourceHash,proofDigest,message:new Uint8Array(message)};
}
// Identity intentionally needs no current clock/grant: durable accepted receipts
// can be looked up before expiration, revocation or action-policy revalidation.
export async function actionProofIdentity(value,crypto){
 const {input,message}=prepare(value);return identity(input,message,crypto);
}
export async function verifyActionProof(value,crypto){
 const {input,message}=prepare(value),{wallet,actionId,proof,signature,nowMs,grant,activeAction}=input;
 nat(nowMs,'acceptance time');
 requireValue(proof.issuedAtMs<=nowMs&&nowMs<proof.expiresMs,'Proof expired or not yet valid.');
 requireValue(grant&&typeof grant==='object'&&!Array.isArray(grant),'Issuer is not currently authorized for this action.');
 for(const key of ['issuerId','actionId','verifier','pubkey'])name(grant[key],'grant '+key);
 checkedKey(grant.pubkey);
 nat(grant.fromEpoch,'grant start epoch');nat(grant.untilEpoch,'grant end epoch');nat(grant.recordedMs,'grant recorded time');
 requireValue(grant.fromEpoch>epochAt(grant.recordedMs)&&grant.untilEpoch>grant.fromEpoch&&grant.untilEpoch-grant.fromEpoch<=366,'Invalid prospective action grant bounds.');
 requireValue(grant.revokedMs===null||Number.isSafeInteger(grant.revokedMs)&&grant.revokedMs>=grant.recordedMs,'Invalid grant revocation time.');
 requireValue(grant.issuerId===proof.issuerId&&grant.actionId===actionId&&digest(grant.revision)&&grant.revision===proof.grantRevision&&grant.recordedMs<=proof.issuedAtMs
  &&epochAt(proof.issuedAtMs)>=grant.fromEpoch&&epochAt(nowMs)<grant.untilEpoch&&(grant.revokedMs===null||nowMs<grant.revokedMs),'Issuer is not currently authorized for this action.');
 requireValue(activeAction&&typeof activeAction==='object'&&!Array.isArray(activeAction)&&activeAction.actionId===actionId&&activeAction.verifier===grant.verifier
  &&Number.isSafeInteger(activeAction.startEpoch)&&activeAction.startEpoch>=0&&activeAction.startEpoch<=epochAt(nowMs)&&(activeAction.enabled===undefined||activeAction.enabled===true),'Action is disabled for this board.');
 const normalized=await identity(input,message,crypto);
 requireValue(await crypto.verifyEd25519({publicKey:grant.pubkey,signature,message:new Uint8Array(message)})===true,'Invalid action attestation.');
 return {issuerId:normalized.issuerId,nonce:normalized.nonce,wallet,actionId,sourceHash:normalized.sourceHash,proofDigest:normalized.proofDigest,
  verifiedAtMs:nowMs,verifier:grant.verifier,sourceRef:'signed:'+normalized.proofDigest};
}
