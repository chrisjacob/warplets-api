import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createAtomicReceipts} from './atomic-receipts.mjs';
import {sql,revisions} from './atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {BUSINESS_TABLES,readSchema} from '../recovery/schema.mjs';
const owner='11111111111111111111111111111111';
function fixture(t){
 const db=openDatabase();t.after(()=>db.close());
 db.prepare('INSERT INTO collect_inventories VALUES(?,?,?,?,?,?,?,?)').run('fixture-inventory','genesis',1,null,null,0,'{}','0'.repeat(64));
 db.prepare('INSERT INTO collect_assets VALUES(?,?,?,?,?,?,?,?)').run('fixture-asset','fixture-inventory',owner,1,1,1,'{}','{}');
 const driver=createNodeAtomicDriver(db),receipts=createAtomicReceipts(driver,{crypto:createNodeCrypto(),ids:{next:randomUUID}});
 async function commit(revision,{omitArtifact=false,omitRevision=false,badOwner=false,priorStateDigest=revision?'a'.repeat(64):null,principal={kind:'wallet',wallet:owner}}={}){
  const stateDigest=(revision?'b':'a').repeat(64),byteDigest=(revision?'d':'c').repeat(64),identity={key:'private/'+byteDigest+'.json',byteDigest,size:123,semanticDigest:stateDigest,visibility:'private',contentType:'application/json'};
  const result={requestId:'fixture-refresh',revision,owner:badOwner?'foreign-owner':owner,assetId:'fixture-asset',requestDigest:'f'.repeat(64),stateDigest,priorStateDigest,identity};
  const command={principal,operationKind:'nfts.refresh.v1',requestKey:'revision-'+revision,requestDigest:'1'.repeat(64),nowMs:revision+10};
  return receipts.execute(command,{businessKey:'fixture-refresh:'+revision,input:revision?{action:'advance',requestId:'fixture-refresh',expectedRevision:revision-1,expectedStateDigest:priorStateDigest,event:{kind:principal.kind==='wallet'?'approve':'validate-reference',input:{}}}:{action:'create',assetId:'fixture-asset',expectedAssetVersion:0,referenceIdentity:null,quoteIdentity:null},result,resultRef:stateDigest,version:revisions(db.prepare('SELECT * FROM app_revisions').all()),child:(gate,args)=>{
   const rows=[];
   if(!omitArtifact)rows.push(sql(`INSERT INTO app_private_artifacts SELECT ?,?,?,?,?,?,? WHERE ${gate}`,identity.key,byteDigest,123,stateDigest,'application/json',command.nowMs,args[0],...args));
   if(!omitRevision)rows.push(sql(`INSERT INTO app_nft_refresh_revisions SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${gate}`,result.requestId,revision,result.owner,result.assetId,result.requestDigest,stateDigest,priorStateDigest,identity.key,args[0],command.nowMs,...args));
   return rows;
  }});
 }
 return {db,driver,commit};
}
test('refresh schema retains exact immutable predecessor and checkpoint lineage',async t=>{
 const f=fixture(t);assert.ok(BUSINESS_TABLES.includes('app_nft_refresh_revisions'));assert.equal((await readSchema(f.driver)).tables.length,BUSINESS_TABLES.length);
 assert.equal((await f.commit(0)).kind,'committed');assert.equal((await f.commit(1)).kind,'committed');assert.equal((await f.commit(1)).kind,'replayed');
 assert.equal(f.db.prepare('SELECT count(*) n FROM app_nft_refresh_revisions').get().n,2);
 assert.throws(()=>f.db.exec("UPDATE app_nft_refresh_revisions SET owner='changed'"),/Retain/);assert.throws(()=>f.db.exec('DELETE FROM app_nft_refresh_revisions'),/Retain/);
});
test('omitted children, foreign owner and predecessor substitution roll back the whole receipt',async t=>{
 for(const options of [{omitArtifact:true},{omitRevision:true},{badOwner:true}]){const f=fixture(t);await assert.rejects(f.commit(0,options));assert.equal(f.db.prepare('SELECT count(*) n FROM app_command_receipts').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM app_private_artifacts').get().n,0);}
 const f=fixture(t);await f.commit(0);await assert.rejects(f.commit(1,{priorStateDigest:'e'.repeat(64)}),/predecessor/);assert.equal(f.db.prepare('SELECT count(*) n FROM app_command_receipts').get().n,1);
});
test('operator scope and recovery holds cannot be bypassed by a staged receipt',async t=>{
 const f=fixture(t),principal={kind:'operator',id:'fixture-reviewer'};await assert.rejects(f.commit(0,{principal}),/guarded/);await f.commit(0);await assert.rejects(f.commit(1,{principal}),/guarded/);
 f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'nft-refresh');assert.equal((await f.commit(1,{principal})).kind,'committed');
 f.db.exec("UPDATE app_recovery_state SET status='held'");await assert.rejects(f.commit(2,{principal,priorStateDigest:'b'.repeat(64)}),/mutation-disabled/);assert.equal(f.db.prepare('SELECT count(*) n FROM app_nft_refresh_revisions').get().n,2);
});
