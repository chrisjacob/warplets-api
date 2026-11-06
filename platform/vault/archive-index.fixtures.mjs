// Partial structural fixture: no claim of complete recovery readiness.
import {createRecoveryV2Codec,recoveryV2IndexSummary} from '../recovery/v2-codec.mjs';
import {schemaDescriptor} from '../recovery/inventory.mjs';
import {utf8} from '../security/canonical.mjs';
import {vaultLiabilityFromRecoveryPage} from './manifest-from-recovery.mjs';
import {VAULT_ARCHIVE_INDEX_TABLES} from './archive-index.mjs';
export async function archiveIndexFixture(crypto,{omit=null}={}){
 const codec=createRecoveryV2Codec({crypto}),objects=new Map(),save=r=>{objects.set(r.identity.key,r.bytes);return r;};let unknown=false;
 const columns=['id','activated_ms','genesis_units','season_units','original_units','seasons','digest'],activatedMs=Date.UTC(2026,10,1),sourceDigest=await crypto.sha256(utf8(JSON.stringify(['synthetic-index-vault',activatedMs,'402600000',[]])));
 const page=save(await codec.encodeRows({format:'10x.local.recovery.rows.v2',table:'vault_manifests',index:0,columns,hasRowid:true,after:null,rows:[[1,'synthetic-index-vault',activatedMs,'20130000','0','402600000','[]',sourceDigest]]}));
 const pages=save(await codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'table-pages',level:0,entries:[{key:'0000000000',value:{identity:page.identity,index:0,rowCount:1,after:null,last:[1]}}]}));
 const entries=[];for(const name of VAULT_ARCHIVE_INDEX_TABLES){if(name===omit)continue;const value=await codec.tableDescriptor(name==='vault_manifests'?{name,columns,primaryKey:['id'],hasRowid:true,rowCount:1,pages:{identity:pages.identity,count:1}}:{name,columns:['id'],primaryKey:['id'],hasRowid:true,rowCount:0,pages:{identity:null,count:0}});entries.push({key:name,value});}
 const leaf=save(await codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'tables',level:0,entries}));
 const tables=save(await codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'tables',level:1,entries:[recoveryV2IndexSummary(leaf.value,leaf.identity)]}));
 const data=save(await codec.encodeIndex({format:'10x.local.recovery.index.v2',kind:'objects',level:0,entries:[{key:page.identity.key,value:page.identity}]}));
 const schema=await schemaDescriptor([{file:'001-synthetic.sql',digest:'a'.repeat(64)}],crypto);
 const root=await codec.encodeRoot({format:'10x.local.recovery.v2',mode:'private',createdMs:activatedMs,sourceCommit:'b'.repeat(40),schema,snapshot:{generation:'synthetic-generation',watermark:'1'},tables:{identity:tables.identity,count:entries.length},objects:{identity:data.identity,count:1},publications:{identity:null,count:0},checkpoints:page.identity,totals:{rows:1,objects:1,bytes:page.bytes.length},authPolicy:'revoke-sessions-and-fence-leases'});
 const store={async getVerified(i){return objects.has(i.key)?{status:'verified',bytes:objects.get(i.key)}:{status:'missing'};},async putIfAbsent(i,bytes){const exists=objects.has(i.key);if(!exists)objects.set(i.key,Uint8Array.from(bytes));return {status:unknown?'unknown':exists?'exists':'created'};}};
 const liability=await vaultLiabilityFromRecoveryPage({rootBytes:root.bytes,rootDigest:root.digest,marketId:'synthetic-index-vault',pageIndex:0},{crypto,store});
 return {objects,store,root,liability,setUnknown:v=>unknown=v,input:{rootBytes:root.bytes,rootDigest:root.digest,liabilityBytes:liability.bytes,liabilityDigest:liability.sha256,pageIndex:0}};
}
