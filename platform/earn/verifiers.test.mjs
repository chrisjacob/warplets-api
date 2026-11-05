import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { openDatabase } from '../storage/database.mjs';
import { DAY_MS } from '../domain/earn/index.mjs';
import { encode58 } from '../server/base58.mjs';
import { createApp } from '../server/application.mjs';
import { configureAction } from './components.mjs';
import { acceptSignedCompletion, grantIssuer, PROOF_DOMAIN, revokeIssuer, signedCompletionBytes } from './verifiers.mjs';
import { configCheckpoint, verifyConfigChain } from '../operations/audit.mjs';

const epoch=20_000,t=epoch*DAY_MS,active=t+DAY_MS;
const issuer=generateKeyPairSync('ed25519'),user=generateKeyPairSync('ed25519');
const pub=key=>encode58(key.export({type:'spki',format:'der'}).subarray(-32));
const wallet=pub(user.publicKey),actionId='follow-test';
function setup(tctx) {
  const db=openDatabase();tctx.after(()=>db.close());
  configureAction(db,{actionId,label:'Follow test project',verifier:'test-verifier',enabled:true,effectiveEpoch:epoch+1,atMs:t});
  const grant=grantIssuer(db,{issuerId:'issuer-1',actionId,verifier:'test-verifier',pubkey:pub(issuer.publicKey),fromEpoch:epoch+1,
    untilEpoch:epoch+4,atMs:t,actor:'founder',evidenceRef:'approved test verifier'});
  return {db,grant};
}
function proof(grant,overrides={}) {
  return {domain:PROOF_DOMAIN,issuerId:grant.issuerId,grantRevision:grant.revision,actionId,wallet,
    nonce:'valid-proof-nonce-0001',issuedAtMs:active,expiresMs:active+120_000,sourceHash:'f'.repeat(64),...overrides};
}
function signature(p,key=issuer.privateKey) {return encode58(sign(null,signedCompletionBytes(p),key));}
test('scoped issuer completion is signed, prospective, replay-safe and counted once',tctx=>{
  const {db,grant}=setup(tctx),p=proof(grant);
  const input={wallet,actionId,proof:p,signature:signature(p),now:active};
  const first=acceptSignedCompletion(db,input);assert.equal(first.replay,false);
  assert.equal(acceptSignedCompletion(db,{...input,now:active+DAY_MS}).replay,true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM earn_action_completions').get().n,1);
  assert.throws(()=>acceptSignedCompletion(db,{...input,actionId:'another'}),/this wallet and action/);
  const changed={...p,sourceHash:'a'.repeat(64)};
  assert.throws(()=>acceptSignedCompletion(db,{...input,proof:changed,signature:signature(changed)}),/nonce/);
  configureAction(db,{actionId,label:'Follow test project',verifier:'test-verifier',enabled:false,effectiveEpoch:epoch+2,atMs:active});
  const later=proof(grant,{nonce:'valid-proof-nonce-0002',issuedAtMs:active+DAY_MS,expiresMs:active+DAY_MS+1000});
  assert.throws(()=>acceptSignedCompletion(db,{...input,proof:later,signature:signature(later),now:active+DAY_MS}),/disabled/);
});
test('forged, wrong-wallet, expired, weak-key and revoked claims fail before credit',tctx=>{
  const {db,grant}=setup(tctx),p=proof(grant),signed=signature(p);
  const input={wallet,actionId,proof:p,signature:signed,now:active};
  assert.throws(()=>acceptSignedCompletion(db,{...input,signature:signature(p,user.privateKey)}),/attestation/);
  assert.throws(()=>acceptSignedCompletion(db,{...input,wallet:pub(issuer.publicKey)}),/wallet/);
  assert.throws(()=>acceptSignedCompletion(db,{...input,now:active+120000}),/expired/);
  assert.throws(()=>grantIssuer(db,{issuerId:'weak',actionId,verifier:'test-verifier',pubkey:encode58(new Uint8Array(32)),fromEpoch:epoch+1,
    untilEpoch:epoch+4,atMs:t,actor:'founder',evidenceRef:'weak'}),/public key/);
  revokeIssuer(db,{issuerId:grant.issuerId,expectedRevision:grant.revision,atMs:active,actor:'founder',evidenceRef:'rotation'});
  assert.throws(()=>acceptSignedCompletion(db,input),/not currently authorized/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM earn_action_completions').get().n,0);
});
test('configuration chain and exported checkpoint are append-only and anchored independently',tctx=>{
  const {db,grant}=setup(tctx);
  const chain=verifyConfigChain(db),checkpoint=configCheckpoint(db);
  assert.equal(chain.events,2);
  assert.equal(configCheckpoint(db,checkpoint.digest).digest,checkpoint.digest);
  revokeIssuer(db,{issuerId:grant.issuerId,expectedRevision:grant.revision,atMs:active,actor:'founder',evidenceRef:'key replaced'});
  assert.equal(verifyConfigChain(db).events,3);
  assert.throws(()=>verifyConfigChain(db,chain.head),/pinned head/);
  assert.throws(()=>db.exec('DELETE FROM ops_config_audit'),/append only/);
  db.exec('DROP TRIGGER ops_audit_no_edit');
  db.prepare('UPDATE ops_config_audit SET payload=? WHERE seq=1').run('{}');
  assert.throws(()=>verifyConfigChain(db),/does not verify/);
});
test('normal API binds a proof to the authenticated wallet and accepts no raw completion flags',async tctx=>{
  const {db,grant}=setup(tctx),p=proof(grant),token='test-session';
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),wallet,'http://localhost',active+DAY_MS);
  const app=createApp(db,{clock:()=>active}),url='http://localhost/api/v1/earn/actions/'+actionId+'/completions';
  const headers={origin:'http://localhost','content-type':'application/json',cookie:'tenx_local_session='+token};
  const request=b=>app(new Request(url,{method:'POST',headers,body:JSON.stringify(b)}));
  assert.equal((await request({complete:true})).status,400);
  const result=await request({proof:p,signature:signature(p)});assert.equal(result.status,200);
  assert.equal((await result.json()).replay,false);
});
