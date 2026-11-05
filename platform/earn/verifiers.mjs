import { createPublicKey, verify } from 'node:crypto';
import { signerKey, signatureBytes } from '../security/ed25519.mjs';
import { transaction } from '../storage/database.mjs';
import { appendAudit } from '../operations/audit.mjs';
import { epochAt } from '../domain/earn/index.mjs';
import { conflict, digest, name, nat, requireValue } from './checks.mjs';
import { listActiveActions, recordActionCompletion } from './components.mjs';

export const PROOF_DOMAIN='10x.local.earn-action.v1';
const SPKI=Buffer.from('302a300506032b6570032100','hex');
function checkedKey(address) {
  try {return signerKey(address);}
  catch {requireValue(false,'Invalid issuer Ed25519 public key.');}
}

export function grantIssuer(db,{issuerId,actionId,verifier,pubkey,fromEpoch,untilEpoch,atMs,actor,evidenceRef}) {
  for(const [field,value] of Object.entries({issuerId,actionId,verifier,actor,evidenceRef}))name(value,field);
  checkedKey(pubkey);nat(fromEpoch,'start epoch');nat(untilEpoch,'end epoch');
  requireValue(fromEpoch>epochAt(atMs)&&untilEpoch>fromEpoch&&untilEpoch-fromEpoch<=366,'Issue a prospective, bounded action grant.');
  const revision=digest([PROOF_DOMAIN,issuerId,actionId,verifier,pubkey,fromEpoch,untilEpoch,atMs,actor,evidenceRef]);
  return transaction(db,()=>{
    const grant=db.prepare('SELECT revision FROM earn_issuer_grants WHERE id=?').get(issuerId);
    if(grant){
      if(grant.revision!==revision)conflict('issuer_conflict','Use a new grant ID when rotating keys or scope.');
      return {issuerId,revision};
    }
    const action=db.prepare('SELECT verifier FROM earn_action_catalog WHERE id=?').get(actionId);
    requireValue(action?.verifier===verifier,'Issuer must match the registered action verifier.');
    db.prepare('INSERT INTO earn_issuer_grants VALUES(?,?,?,?,?,?,?,?)').run(issuerId,actionId,verifier,pubkey,fromEpoch,untilEpoch,atMs,revision);
    appendAudit(db,{category:'issuer-grant',entity:issuerId,changeKey:revision,atMs,actor,evidenceRef,
      payload:{actionId,verifier,pubkey,fromEpoch,untilEpoch,revision}});
    return {issuerId,revision};
  });
}
export function revokeIssuer(db,{issuerId,expectedRevision,atMs,actor,evidenceRef}) {
  name(issuerId,'issuer');nat(atMs,'revocation time');name(actor,'operator');name(evidenceRef,'evidence');
  return transaction(db,()=>{
    const grant=db.prepare('SELECT revision,recorded_ms FROM earn_issuer_grants WHERE id=?').get(issuerId);
    requireValue(grant && grant.revision===expectedRevision && atMs>=grant.recorded_ms,'Expected the existing issuer grant.');
    const revision=digest([expectedRevision,atMs,actor,evidenceRef]);
    const prior=db.prepare('SELECT revision FROM earn_issuer_revocations WHERE issuer_id=?').get(issuerId);
    if(prior){
      if(prior.revision!==revision)conflict('issuer_revoked','Issuer has already been revoked.');
      return {issuerId,revision};
    }
    db.prepare('INSERT INTO earn_issuer_revocations VALUES(?,?,?)').run(issuerId,atMs,revision);
    appendAudit(db,{category:'issuer-revoke',entity:issuerId,changeKey:revision,atMs,actor,evidenceRef,payload:{expectedRevision}});
    return {issuerId,revision};
  });
}

const signedFields=['domain','issuerId','grantRevision','actionId','wallet','nonce','issuedAtMs','expiresMs','sourceHash'];
export function signedCompletionBytes(proof) {
  requireValue(proof && Object.keys(proof).length===signedFields.length && signedFields.every(k=>Object.hasOwn(proof,k)),'Unexpected proof fields.');
  requireValue(proof.domain===PROOF_DOMAIN,'Wrong action-proof domain.');
  for(const key of ['issuerId','actionId','wallet'])name(proof[key],key);
  checkedKey(proof.wallet);
  requireValue(typeof proof.nonce==='string'&&/^[A-Za-z0-9_-]{16,96}$/.test(proof.nonce),'Invalid one-use nonce.');
  requireValue([proof.grantRevision,proof.sourceHash].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)),'Expected SHA-256 references.');
  nat(proof.issuedAtMs,'issue time');nat(proof.expiresMs,'expiry');
  requireValue(proof.expiresMs>proof.issuedAtMs && proof.expiresMs-proof.issuedAtMs<=600000,'Proof lifetime is at most ten minutes.');
  return Buffer.from(JSON.stringify(signedFields.map(k=>proof[k])),'utf8');
}
export function acceptSignedCompletion(db,{wallet,actionId,proof,signature,now}) {
  nat(now,'acceptance time');
  const message=signedCompletionBytes(proof);
  requireValue(proof.wallet===wallet&&proof.actionId===actionId,'Proof does not belong to this wallet and action.');
  const hash=digest([PROOF_DOMAIN,message.toString('base64'),signature]);
  return transaction(db,()=>{
    const prior=db.prepare('SELECT * FROM earn_signed_completions WHERE issuer_id=? AND nonce=?').get(proof.issuerId,proof.nonce);
    if(prior) {
      if(prior.proof_digest!==hash)conflict('nonce_conflict','Issuer nonce already identifies another proof.');
      return {actionId,verifiedAtMs:prior.accepted_ms,proofDigest:hash,replay:true};
    }
    requireValue(proof.issuedAtMs<=now&&now<proof.expiresMs,'Proof expired or not yet valid.');
    const grant=db.prepare(`SELECT g.*,r.revoked_ms FROM earn_issuer_grants g LEFT JOIN earn_issuer_revocations r ON r.issuer_id=g.id WHERE g.id=?`).get(proof.issuerId);
    requireValue(grant&&grant.revision===proof.grantRevision&&grant.action_id===actionId&&
      epochAt(proof.issuedAtMs)>=grant.from_epoch&&epochAt(now)<grant.until_epoch&&
      (grant.revoked_ms==null||now<grant.revoked_ms),'Issuer is not currently authorized for this action.');
    requireValue(listActiveActions(db,epochAt(now)).some(a=>a.actionId===actionId&&a.verifier===grant.verifier),'Action is disabled for this board.');
    const key=createPublicKey({key:Buffer.concat([SPKI,checkedKey(grant.pubkey)]),format:'der',type:'spki'});
    let sig;try{sig=signatureBytes(signature);}catch{requireValue(false,'Invalid Ed25519 signature bytes.');}
    requireValue(verify(null,message,key,sig),'Invalid action attestation.');
    recordActionCompletion(db,{wallet,actionId,verifier:grant.verifier,verifiedMs:now,sourceRef:'signed:'+hash});
    db.prepare('INSERT INTO earn_signed_completions VALUES(?,?,?,?,?,?,?)').run(proof.issuerId,proof.nonce,wallet,actionId,hash,proof.sourceHash,now);
    return {actionId,verifiedAtMs:now,proofDigest:hash,replay:false};
  });
}
