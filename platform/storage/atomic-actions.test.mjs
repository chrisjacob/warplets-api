import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {encode58} from '../server/base58.mjs';
import {PROOF_DOMAIN,signedCompletionBytes} from '../earn/action-proof.mjs';
import {createActionCommand,createAtomicActionRepository,ACCEPT_ACTION} from './atomic-actions.mjs';
const crypto=createNodeCrypto(),issuer=generateKeyPairSync('ed25519'),users=[generateKeyPairSync('ed25519'),generateKeyPairSync('ed25519')];
const pub=key=>encode58(key.export({type:'spki',format:'der'}).subarray(-32)),wallets=users.map(u=>pub(u.publicKey)),actionId='synthetic-action',epoch=21,nowMs=epoch*86400000+100;
function fixture(t){
 const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db),ports={crypto,ids:{next:randomUUID}};
 db.prepare('INSERT INTO earn_action_catalog VALUES(?,?,?)').run(actionId,'Synthetic action','synthetic-verifier');
 db.prepare('INSERT INTO earn_action_changes VALUES(?,?,?,?)').run(actionId,epoch,1,nowMs-86400000);
 db.prepare('INSERT INTO earn_issuer_grants VALUES(?,?,?,?,?,?,?,?)').run('synthetic-issuer',actionId,'synthetic-verifier',pub(issuer.publicKey),epoch,epoch+3,nowMs-86400000,'a'.repeat(64));
 return {db,driver,ports,repository:createAtomicActionRepository(driver,ports)};
}
async function command({wallet=wallets[0],nonce='synthetic-proof-nonce-0001',sourceHash='f'.repeat(64)}={}){
 const proof={domain:PROOF_DOMAIN,issuerId:'synthetic-issuer',grantRevision:'a'.repeat(64),actionId,wallet,nonce,issuedAtMs:nowMs,expiresMs:nowMs+120000,sourceHash};
 return createActionCommand({principal:{kind:'wallet',wallet},input:{actionId,proof,signature:encode58(sign(null,signedCompletionBytes(proof),issuer.privateKey))},nowMs},crypto);
}
function count(db,table){return db.prepare('SELECT COUNT(*) n FROM '+table).get().n;}
test('atomic action accepts exactly one signed completion and replays after expiry, revocation and disabling',async t=>{
 const {db,repository}=fixture(t),c=await command(),results=await Promise.all([repository.acceptCompletion(c),repository.acceptCompletion(c)]);
 assert.deepEqual(results.map(r=>r.kind).sort(),['committed','replayed']);
 assert.equal(count(db,'earn_action_completions'),1);assert.equal(count(db,'earn_signed_completions'),1);
 const receipt=db.prepare('SELECT * FROM app_command_receipts WHERE operation_kind=?').get(ACCEPT_ACTION);
 assert.equal(receipt.state,'committed');assert.equal(receipt.result_ref,c.requestKey);
 db.prepare('INSERT INTO earn_issuer_revocations VALUES(?,?,?)').run('synthetic-issuer',nowMs+1,'b'.repeat(64));
 db.prepare('UPDATE earn_action_changes SET enabled=0').run();
 const replay=await repository.acceptCompletion({...c,nowMs:nowMs+86400000});
 assert.equal(replay.kind,'replayed');assert.deepEqual(replay.receipt,results[0].receipt);assert.deepEqual(replay.value,results[0].value);
 assert.equal(count(db,'app_command_receipts'),1);
});
test('omitting either mandatory action effect rolls the receipt and the other child back',async t=>{
 const {db,driver,ports}=fixture(t),c=await command();
 for(const table of ['earn_signed_completions','earn_action_completions']){
  const omitted={...driver,async batch(statements){return driver.batch(statements.filter(s=>!s.sql.startsWith('INSERT INTO '+table)));}};
  await assert.rejects(createAtomicActionRepository(omitted,ports).acceptCompletion(c),/Missing signed action effects/);
  for(const table of ['app_command_receipts','earn_signed_completions','earn_action_completions'])assert.equal(count(db,table),0);
 }
 assert.equal((await createAtomicActionRepository(driver,ports).acceptCompletion(c)).kind,'committed');
});
test('issuer nonce race across wallets and different nonce race for the same wallet/action cannot double-credit',async t=>{
 for(const kind of ['nonce','wallet-action']){
  const {db,repository}=fixture(t),first=await command(),second=await command(kind==='nonce'?{wallet:wallets[1]}:{nonce:'synthetic-proof-nonce-0002'});
  const results=await Promise.all([repository.acceptCompletion(first),repository.acceptCompletion(second)]);
  assert.equal(results.filter(r=>r.kind==='committed').length,1);assert.equal(results.filter(r=>r.kind==='conflict').length,1);
  assert.equal(count(db,'earn_action_completions'),1);assert.equal(count(db,'earn_signed_completions'),1);assert.equal(count(db,'app_command_receipts'),1);
  const loser=results[0].kind==='committed'?second:first,retry=await repository.acceptCompletion(loser);
  assert.equal(retry.code,kind==='nonce'?'nonce_conflict':'completion_exists');
 }
});
test('revocation during asynchronous signature verification rejects the whole atomic result',async t=>{
 const {db,driver,ports}=fixture(t),c=await command();let revoked=false;
 const racingCrypto={...crypto,async verifyEd25519(value){if(!revoked){revoked=true;db.prepare('INSERT INTO earn_issuer_revocations VALUES(?,?,?)').run('synthetic-issuer',nowMs,'b'.repeat(64));}return crypto.verifyEd25519(value);}};
 const repository=createAtomicActionRepository(driver,{...ports,crypto:racingCrypto});
 assert.equal((await repository.acceptCompletion(c)).code,'revision_conflict');
 assert.equal(count(db,'app_command_receipts'),0);assert.equal(count(db,'earn_action_completions'),0);
 await assert.rejects(repository.acceptCompletion(c),/not currently authorized/);
});
test('lost response reconciles committed receipt and caller mutation cannot rewrite accepted identity',async t=>{
 const {db,driver,ports}=fixture(t),c=await command(),original=structuredClone(c);let lost=false;
 const fault={...driver,async batch(statements){const result=await driver.batch(statements);if(!lost&&statements.some(s=>s.sql.startsWith('INSERT INTO earn_signed_completions'))){lost=true;throw Error('lost action response');}return result;}};
 const racingCrypto={...crypto,async sha256(bytes){c.principal.wallet=wallets[1];c.input.proof.sourceHash='b'.repeat(64);c.input.proof.nonce='changed-proof-nonce-001';return crypto.sha256(bytes);}};
 const result=await createAtomicActionRepository(fault,{...ports,crypto:racingCrypto}).acceptCompletion(c);
 assert.equal(result.kind,'replayed');assert.equal(lost,true);assert.equal(result.receipt.requestDigest,original.requestDigest);
 const row=db.prepare('SELECT * FROM earn_signed_completions').get();assert.equal(row.wallet,original.principal.wallet);assert.equal(row.source_hash,original.input.proof.sourceHash);
 assert.equal(count(db,'app_command_receipts'),1);
});
test('wrong wallet, disabled/revoked grant, stale revision and finalized board fail before new credit',async t=>{
 const wrong=await command();await assert.rejects(createActionCommand({principal:{kind:'wallet',wallet:wallets[1]},input:wrong.input,nowMs},crypto),/wallet and action/);
 for(const variant of ['disabled','revoked','stale','closed','grant']){
  const {db,repository}=fixture(t),c=await command();
  if(variant==='disabled')db.prepare('UPDATE earn_action_changes SET enabled=0').run();
  if(variant==='revoked')db.prepare('INSERT INTO earn_issuer_revocations VALUES(?,?,?)').run('synthetic-issuer',nowMs,'b'.repeat(64));
  if(variant==='closed')db.prepare('INSERT INTO earn_boards VALUES(?,?,?,?,?)').run(epoch,'[]',nowMs,'synthetic-closed','synthetic');
  if(variant==='grant'){c.input.proof.grantRevision='b'.repeat(64);c.input.signature=encode58(sign(null,signedCompletionBytes(c.input.proof),issuer.privateKey));Object.assign(c,await createActionCommand({principal:c.principal,input:c.input,nowMs},crypto));}
  if(variant==='stale')c.expectedRevisions={source:'999'};
  if(['disabled','revoked','grant'].includes(variant))await assert.rejects(repository.acceptCompletion(c),/disabled|authorized/);
  else assert.equal((await repository.acceptCompletion(c)).code,variant==='closed'?'board_closed':'revision_conflict');
  assert.equal(count(db,'earn_action_completions'),0);assert.equal(count(db,'earn_signed_completions'),0);assert.equal(count(db,'app_command_receipts'),0);
 }
});
test('caller input cannot override the authenticated wallet through an extra field',async()=>{
 const signed=await command({wallet:wallets[1]});
 await assert.rejects(createActionCommand({principal:{kind:'wallet',wallet:wallets[0]},input:{...signed.input,wallet:wallets[1]},nowMs},crypto),error=>error.code==='invalid_input');
});
