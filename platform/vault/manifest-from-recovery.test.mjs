import test from 'node:test';
import assert from 'node:assert/strict';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {utf8} from '../security/canonical.mjs';
import {schemaDescriptor} from '../recovery/inventory.mjs';
import {createRecoveryV2Codec,recoveryV2IndexSummary} from '../recovery/v2-codec.mjs';
import {vaultLiabilityFromRecoveryPage} from './manifest-from-recovery.mjs';
const crypto=createNodeCrypto();
async function fixture({wrongBudget=false}={}){
 const codec=createRecoveryV2Codec({crypto}),objects=new Map(),save=r=>{objects.set(r.identity.key,r.bytes);return r;};
 const columns=['id','activated_ms','genesis_units','season_units','original_units','seasons','digest'],activatedMs=Date.UTC(2026,10,1),sourceDigest=await crypto.sha256(utf8(JSON.stringify(['synthetic-vault',activatedMs,'402600000',[]])));
 const page=save(await codec.encodeRows({format:'10x.local.recovery.rows.v2',table:'vault_manifests',index:0,columns,hasRowid:true,after:null,rows:[[1,'synthetic-vault',activatedMs,wrongBudget?'1':'20130000','0','402600000','[]',sourceDigest]]}));
 const pages=save(await codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'table-pages',level:0,entries:[{key:'0000000000',value:{identity:page.identity,index:0,rowCount:1,after:null,last:[1]}}]}));
 const table=await codec.tableDescriptor({name:'vault_manifests',columns,primaryKey:['id'],hasRowid:true,rowCount:1,pages:{identity:pages.identity,count:1}});
 const tableLeaf=save(await codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'tables',level:0,entries:[{key:'vault_manifests',value:table}]}));
 const tables=save(await codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'tables',level:1,entries:[recoveryV2IndexSummary(tableLeaf.value,tableLeaf.identity)]}));
 const data=save(await codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'objects',level:0,entries:[{key:page.identity.key,value:page.identity}]}));
 const schema=await schemaDescriptor([{file:'001-synthetic.sql',digest:'a'.repeat(64)}],crypto);
 // A deliberately partial structural fixture, never a full recovery-ready root.
 const root=await codec.encodeRoot({format:'10x.local.recovery.v2',mode:'private',createdMs:activatedMs,sourceCommit:'b'.repeat(40),schema,snapshot:{generation:'synthetic-generation',watermark:'1'},tables:{identity:tables.identity,count:1},objects:{identity:data.identity,count:1},publications:{identity:null,count:0},checkpoints:page.identity,totals:{rows:1,objects:1,bytes:page.bytes.length},authPolicy:'revoke-sessions-and-fence-leases'});
 const store={async getVerified(i){return objects.has(i.key)?{status:'verified',bytes:objects.get(i.key)}:{status:'missing'};}};
 return {objects,page,root,store,input:{rootBytes:root.bytes,rootDigest:root.digest,marketId:'synthetic-vault',pageIndex:0}};
}
test('derives compact liabilities from the exact independently pinned v2 table and page',async()=>{
 const f=await fixture(),r=await vaultLiabilityFromRecoveryPage(f.input,{crypto,store:f.store});
 assert.equal(r.manifest.inventoryCommitment,f.root.digest);assert.equal(r.manifest.genesis.budgetUnits,'20130000');assert.equal(r.source.pageDigest,f.page.identity.byteDigest);
 assert.equal(r.fullRecoveryVerified,false);assert.equal(r.verification,'pinned-liability-page-only');assert.equal(r.financialExecution,false);
});
test('wrong root, lying object store, absent selection and rehashed inconsistent budgets cannot pass',async()=>{
 const f=await fixture(),ports={crypto,store:f.store};
 await assert.rejects(vaultLiabilityFromRecoveryPage({...f.input,rootDigest:'c'.repeat(64)},ports));
 await assert.rejects(vaultLiabilityFromRecoveryPage({...f.input,marketId:'absent'},ports));
 await assert.rejects(vaultLiabilityFromRecoveryPage({...f.input,pageIndex:1},ports));
 const original=f.objects.get(f.page.identity.key),changed=Uint8Array.from(original);changed[0]^=1;f.objects.set(f.page.identity.key,changed);
 await assert.rejects(vaultLiabilityFromRecoveryPage(f.input,ports));
 const bad=await fixture({wrongBudget:true});await assert.rejects(vaultLiabilityFromRecoveryPage(bad.input,{crypto,store:bad.store}),/budgets mismatch/);
});
