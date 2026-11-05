import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {localRuntime} from './local-runtime.mjs';
import {encode58} from '../../server/base58.mjs';
import {createNodeCrypto} from '../../security/node-crypto.mjs';
import {PROOF_DOMAIN,signedCompletionBytes} from '../../earn/action-proof.mjs';
import {createActionCommand} from '../../storage/atomic-actions.mjs';
const crypto=createNodeCrypto(),issuer=generateKeyPairSync('ed25519'),publicKey=key=>encode58(key.export({type:'spki',format:'der'}).subarray(-32));
const wallets=Array.from({length:5},()=>publicKey(generateKeyPairSync('ed25519').publicKey)),actionId='synthetic-action',epoch=21,nowMs=epoch*86400000+100;
async function command(wallet=wallets[0],nonce='synthetic-d1-nonce-0001',grantRevision='a'.repeat(64)){
 const proof={domain:PROOF_DOMAIN,issuerId:'synthetic-issuer',grantRevision,actionId,wallet,nonce,issuedAtMs:nowMs,expiresMs:nowMs+120000,sourceHash:'f'.repeat(64)};
 return createActionCommand({principal:{kind:'wallet',wallet},input:{actionId,proof,signature:encode58(sign(null,signedCompletionBytes(proof),issuer.privateKey))},nowMs},crypto);
}
test('workerd D1 signed action effects are atomic, race-safe, revision guarded and replayable',async t=>{
 const {mf,db}=await localRuntime(t,new URL('./fixtures/action-completion-worker.ts',import.meta.url));
 await db.prepare('INSERT INTO earn_action_catalog VALUES(?,?,?)').bind(actionId,'Synthetic action','synthetic-verifier').run();
 await db.prepare('INSERT INTO earn_action_changes VALUES(?,?,?,?)').bind(actionId,epoch,1,nowMs-86400000).run();
 await db.prepare('INSERT INTO earn_issuer_grants VALUES(?,?,?,?,?,?,?,?)').bind('synthetic-issuer',actionId,'synthetic-verifier',publicKey(issuer.publicKey),epoch,epoch+3,nowMs-86400000,'a'.repeat(64)).run();
 const call=async(command,fault)=>{const response=await mf.dispatchFetch('http://localhost/fixture',{method:'POST',body:JSON.stringify({command,fault})});return {status:response.status,result:await response.json()};};
 const count=table=>db.prepare('SELECT COUNT(*) n FROM '+table).first('n'),first=await command();
 for(const fault of ['omit-signed','omit-completion']){
  const failed=await call(first,fault);assert.equal(failed.status,500);assert.match(failed.result.error,/Missing signed action effects/);
  for(const table of ['app_command_receipts','earn_action_completions','earn_signed_completions'])assert.equal(await count(table),0);
 }
 const wrong=await call(await command(wallets[0],'synthetic-wrong-grant','b'.repeat(64)));assert.equal(wrong.status,400);assert.match(wrong.result.error,/authorized/);
 await db.prepare('UPDATE earn_action_changes SET enabled=0').run();
 const disabled=await call(first);assert.equal(disabled.status,400);assert.match(disabled.result.error,/disabled/);
 await db.prepare('UPDATE earn_action_changes SET enabled=1').run();
 const duplicate=await Promise.all([call(first,'lose-response'),call(first)]);
 assert.ok(duplicate.every(r=>r.status===200&&['committed','replayed'].includes(r.result.kind)));
 assert.equal(await count('earn_action_completions'),1);assert.equal(await count('earn_signed_completions'),1);
 const sameWallet=[await command(wallets[1],'synthetic-wallet-nonce-0001'),await command(wallets[1],'synthetic-wallet-nonce-0002')];
 const walletRace=await Promise.all(sameWallet.map(c=>call(c)));assert.equal(walletRace.filter(r=>r.result.kind==='committed').length,1);assert.equal(walletRace.filter(r=>r.result.kind==='conflict').length,1);
 const sameNonce=[await command(wallets[2],'synthetic-shared-nonce-0001'),await command(wallets[3],'synthetic-shared-nonce-0001')];
 const nonceRace=await Promise.all(sameNonce.map(c=>call(c)));assert.equal(nonceRace.filter(r=>r.result.kind==='committed').length,1);assert.equal(nonceRace.filter(r=>r.result.kind==='conflict').length,1);
 assert.equal(await count('app_command_receipts'),3);assert.equal(await count('earn_signed_completions'),3);
 const racing=await call(await command(wallets[4],'synthetic-revoke-nonce-0001'),'revoke-during-verify');
 assert.equal(racing.result.code,'revision_conflict');assert.equal(await count('app_command_receipts'),3);assert.equal(await count('earn_action_completions'),3);
 const revoked=await call(await command(wallets[4],'synthetic-revoke-nonce-0001'));assert.equal(revoked.status,400);assert.match(revoked.result.error,/authorized/);
 await db.prepare('UPDATE earn_action_changes SET enabled=0').run();
 const replay=await call({...first,nowMs:nowMs+86400000});assert.equal(replay.result.kind,'replayed');assert.equal(replay.result.value.proofDigest,first.requestKey);
 assert.equal(replay.result.value.verifiedAtMs,nowMs);assert.equal(await count('app_command_receipts'),3);
});
