import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createWebCrypto} from '../security/web-crypto.mjs';
import {encode58} from '../server/base58.mjs';
import {DAY_MS} from '../domain/earn/index.mjs';
import {digest,EarnError} from './checks.mjs';
import {PROOF_DOMAIN as LEGACY_DOMAIN,signedCompletionBytes as legacyBytes,acceptSignedCompletion,grantIssuer} from './verifiers.mjs';
import {configureAction} from './components.mjs';
import {openDatabase} from '../storage/database.mjs';
import {PROOF_DOMAIN,signedCompletionBytes,actionProofIdentity,verifyActionProof} from './action-proof.mjs';
const nodeCrypto=createNodeCrypto(),epoch=20,at=epoch*DAY_MS,nowMs=at+DAY_MS;
const issuer=generateKeyPairSync('ed25519'),user=generateKeyPairSync('ed25519'),publicKey=key=>encode58(key.export({type:'spki',format:'der'}).subarray(-32));
const wallet=publicKey(user.publicKey),actionId='synthetic-follow',verifier='synthetic-verifier';
function fixture(){
 const grant={issuerId:'synthetic-issuer',actionId,verifier,pubkey:publicKey(issuer.publicKey),fromEpoch:epoch+1,untilEpoch:epoch+4,recordedMs:at,revision:'a'.repeat(64),revokedMs:null};
 const proof={domain:PROOF_DOMAIN,issuerId:grant.issuerId,grantRevision:grant.revision,actionId,wallet,nonce:'synthetic-proof-nonce-0001',issuedAtMs:nowMs,expiresMs:nowMs+120000,sourceHash:'f'.repeat(64)};
 return {wallet,actionId,proof,signature:encode58(sign(null,legacyBytes(proof),issuer.privateKey)),nowMs,grant,activeAction:{actionId,verifier,startEpoch:epoch+1}};
}
test('portable signed bytes, base64 identity and proof digest match the legacy protocol in Node and WebCrypto',async()=>{
 assert.equal(PROOF_DOMAIN,LEGACY_DOMAIN);
 for(const nonce of ['synthetic-proof-001','synthetic-proof-0001','synthetic-proof-00001']){
  const value=fixture();value.proof.nonce=nonce;value.signature=encode58(sign(null,legacyBytes(value.proof),issuer.privateKey));
  const message=legacyBytes(value.proof),expected=digest([PROOF_DOMAIN,message.toString('base64'),value.signature]);
  assert.deepEqual(signedCompletionBytes(value.proof),new Uint8Array(message));
  for(const crypto of [nodeCrypto,createWebCrypto(webcrypto)]){
   const identity=await actionProofIdentity(value,crypto),accepted=await verifyActionProof(value,crypto);
   assert.equal(identity.proofDigest,expected);assert.deepEqual(identity.message,new Uint8Array(message));assert.equal(accepted.proofDigest,expected);
   assert.deepEqual(accepted,{issuerId:value.proof.issuerId,nonce,wallet,actionId,sourceHash:value.proof.sourceHash,proofDigest:expected,verifiedAtMs:nowMs,verifier,sourceRef:'signed:'+expected});
  }
 }
});
test('portable accepted result equals the persisted legacy proof digest and authority',async t=>{
 const db=openDatabase();t.after(()=>db.close());configureAction(db,{actionId,label:'Synthetic follow',verifier,enabled:true,effectiveEpoch:epoch+1,atMs:at});
 const grant=grantIssuer(db,{issuerId:'synthetic-issuer',actionId,verifier,pubkey:publicKey(issuer.publicKey),fromEpoch:epoch+1,untilEpoch:epoch+4,atMs:at,actor:'synthetic-operator',evidenceRef:'synthetic-grant'});
 const value=fixture();value.grant.revision=grant.revision;value.proof.grantRevision=grant.revision;value.signature=encode58(sign(null,legacyBytes(value.proof),issuer.privateKey));
 const legacy=acceptSignedCompletion(db,{...value,now:nowMs}),portable=await verifyActionProof(value,nodeCrypto);
 assert.equal(portable.proofDigest,legacy.proofDigest);assert.equal(portable.verifiedAtMs,legacy.verifiedAtMs);
 const row=db.prepare('SELECT * FROM earn_action_completions').get();assert.equal(row.source_ref,portable.sourceRef);assert.equal(row.verifier,portable.verifier);
});
test('strict proof fields, domain, nonce, keys, signature bytes and lifetime reject before verification',async()=>{
 const invalid=[
  [v=>v.proof.extra=true,/Unexpected proof fields/],
  [v=>delete v.proof.nonce,/Unexpected proof fields/],
  [v=>v.proof.domain='other-domain',/domain/],
  [v=>v.proof.nonce='short',/nonce/],
  [v=>v.proof.nonce='x'.repeat(97),/nonce/],
  [v=>v.proof.nonce='contains bad chars',/nonce/],
  [v=>v.proof.grantRevision='A'.repeat(64),/SHA-256/],
  [v=>v.proof.sourceHash='f'.repeat(63),/SHA-256/],
  [v=>v.proof.wallet=encode58(new Uint8Array(32)),/public key/],
  [v=>v.proof.wallet='not-base58!',/public key/],
  [v=>v.signature='invalid!',/signature bytes/],
  [v=>v.signature=encode58(new Uint8Array(64)),/signature bytes/],
  [v=>v.proof.issuedAtMs=-1,/issue time/],
  [v=>v.proof.expiresMs=v.proof.issuedAtMs,/ten minutes/],
  [v=>v.proof.expiresMs=v.proof.issuedAtMs+600001,/ten minutes/],
 ];
 let calls=0;const crypto={...nodeCrypto,async verifyEd25519(){calls++;throw Error('must reject first');}};
 for(const [mutate,reason] of invalid){const value=fixture();mutate(value);await assert.rejects(verifyActionProof(value,crypto),error=>error instanceof EarnError&&reason.test(error.message));}
 assert.equal(calls,0);
});
test('authenticated identity, exact expiry, scoped grant and active policy are mandatory',async()=>{
 const invalid=[
  [v=>v.wallet=publicKey(issuer.publicKey),/wallet and action/],
  [v=>v.actionId='another',/wallet and action/],
  [v=>v.nowMs--,/expired/],
  [v=>v.nowMs=v.proof.expiresMs,/expired/],
  [v=>v.grant=null,/authorized/],
  [v=>v.grant.issuerId='another',/authorized/],
  [v=>v.grant.actionId='another',/authorized/],
  [v=>v.grant.revision='b'.repeat(64),/authorized/],
  [v=>v.grant.fromEpoch=epoch,/prospective/],
  [v=>v.grant.untilEpoch=v.grant.fromEpoch,/bounds/],
  [v=>v.grant.untilEpoch=v.grant.fromEpoch+367,/bounds/],
  [v=>v.grant.fromEpoch=epoch+2,/authorized/],
  [v=>v.grant.recordedMs=nowMs+1,/prospective/],
  [v=>v.grant.revokedMs=nowMs,/authorized/],
  [v=>v.grant.revokedMs=at-1,/revocation/],
  [v=>v.grant.pubkey=encode58(new Uint8Array(32)),/public key/],
  [v=>v.activeAction=null,/disabled/],
  [v=>v.activeAction.verifier='another',/disabled/],
  [v=>v.activeAction.actionId='another',/disabled/],
  [v=>v.activeAction.startEpoch=epoch+2,/disabled/],
  [v=>v.activeAction.enabled=false,/disabled/],
  [v=>v.activeAction.enabled=0,/disabled/],
 ];
 for(const [mutate,reason] of invalid){const value=fixture();mutate(value);await assert.rejects(verifyActionProof(value,nodeCrypto),error=>error instanceof EarnError&&reason.test(error.message));}
 const forged=fixture();forged.signature=encode58(sign(null,legacyBytes(forged.proof),user.privateKey));await assert.rejects(verifyActionProof(forged,nodeCrypto),/attestation/);
});
test('identity remains usable for durable replay after expiry and all inputs are captured across async crypto',async()=>{
 const value=fixture(),before=structuredClone(value),expected=await verifyActionProof(value,nodeCrypto);
 const crypto={async sha256(bytes){value.proof.sourceHash='b'.repeat(64);value.proof.nonce='changed-nonce-0001';value.grant.revokedMs=0;value.activeAction.verifier='another';return nodeCrypto.sha256(bytes);},
  async verifyEd25519(input){value.grant.pubkey=publicKey(user.publicKey);value.wallet=publicKey(issuer.publicKey);return nodeCrypto.verifyEd25519(input);}};
 assert.deepEqual(await verifyActionProof(value,crypto),expected);
 const identity=await actionProofIdentity({wallet:before.wallet,actionId:before.actionId,proof:before.proof,signature:before.signature},nodeCrypto);
 assert.equal(identity.proofDigest,expected.proofDigest);identity.message.fill(0);assert.deepEqual(before.proof,fixture().proof);
 const expired={...before,nowMs:before.proof.expiresMs,grant:{...before.grant,revokedMs:before.proof.expiresMs}};
 assert.equal((await actionProofIdentity(expired,nodeCrypto)).proofDigest,expected.proofDigest);
 await assert.rejects(verifyActionProof(expired,nodeCrypto),/expired/);
});
