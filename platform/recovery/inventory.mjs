import {canonicalJson,utf8} from '../security/canonical.mjs';
import {artifactIdentity,privateIdentity} from '../artifacts/identity.mjs';

export const RECOVERY_FORMAT='10x.local.recovery.v1';
export const RECOVERY_LIMITS=Object.freeze({inventoryBytes:256*1024,pageBytes:256*1024,totalBytes:24*1024*1024,objects:8192,tableRows:8192,tables:128,finishOperations:900});
export const clone=value=>JSON.parse(canonicalJson(value));
export const demand=(value,message)=>{if(!value)throw new TypeError(message);};
export const isDigest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const exact=(value,keys,label)=>demand(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),'Invalid '+label+' fields.');
export const hashJson=(crypto,value)=>crypto.sha256(utf8(canonicalJson(value)));
export async function schemaDescriptor(migrations,crypto){
 migrations=clone(migrations);demand(Array.isArray(migrations)&&migrations.length>0&&migrations.length<=128,'Invalid recovery migration inventory.');
 let previous='';for(const m of migrations){exact(m,['file','digest'],'migration');demand(/^\d{3}-[\w-]+\.sql$/.test(m.file)&&m.file>previous&&isDigest(m.digest),'Invalid ordered migration identity.');previous=m.file;}
 return {migrations,fingerprint:await hashJson(crypto,['10x-recovery-schema-v1',migrations])};
}

function validateInventory(value){
 exact(value,['format','mode','createdMs','sourceCommit','schema','tables','objects','publications','checkpoints','authPolicy'],'recovery inventory');
 demand(value.format===RECOVERY_FORMAT&&['public','private'].includes(value.mode),'Unsupported recovery format.');
 demand(Number.isSafeInteger(value.createdMs)&&value.createdMs>=0&&/^[a-f0-9]{40}$/.test(value.sourceCommit),'Invalid recovery source identity.');
 demand(Array.isArray(value.tables)&&value.tables.length<=RECOVERY_LIMITS.tables&&Array.isArray(value.objects)&&value.objects.length<=RECOVERY_LIMITS.objects,'Recovery inventory bound.');
 demand(Array.isArray(value.publications)&&value.publications.length<=4096,'Public inventory bound.');
 const objects=new Map();let previous='',totalBytes=0;
 for(const raw of value.objects){const i=artifactIdentity(raw);demand(i.key>previous&&!objects.has(i.key),'Unordered or duplicate recovery object.');previous=i.key;objects.set(i.key,i);totalBytes+=i.size;}
 demand(totalBytes<=RECOVERY_LIMITS.totalBytes,'Recovery aggregate object byte bound.');
 const publicKeys=new Set();for(const p of value.publications){
  exact(p,['identity','semanticDigest','boardId','epoch','allocations'],'public recovery pin');const i=artifactIdentity(p.identity);
  demand(i.visibility==='public'&&isDigest(p.semanticDigest)&&i.semanticDigest===p.semanticDigest&&isDigest(p.boardId)&&Number.isSafeInteger(p.epoch)&&p.epoch>=0,'Invalid public recovery commitment.');
  demand(objects.has(i.key)&&canonicalJson(objects.get(i.key))===canonicalJson(i)&&!publicKeys.has(i.key),'Unlisted or duplicate public recovery object.');publicKeys.add(i.key);
  demand(Array.isArray(p.allocations)&&p.allocations.length<=32,'Recovery allocation bound.');
  for(const a of p.allocations){exact(a,['tokenId','day','allocationId','awardRoot'],'allocation pin');demand(typeof a.tokenId==='string'&&a.tokenId.length>0&&a.tokenId.length<=256&&Number.isInteger(a.day)&&a.day>=1&&a.day<=10&&isDigest(a.allocationId)&&isDigest(a.awardRoot),'Invalid allocation pin.');}
 }
 const pageKeys=new Set();previous='';for(const table of value.tables){
  exact(table,['name','columns','primaryKey','hasRowid','rowCount','rowsDigest','pages'],'recovery table');
  demand(/^[a-z][a-z0-9_]*$/.test(table.name)&&table.name>previous,'Unordered recovery table.');previous=table.name;
  demand(Array.isArray(table.columns)&&table.columns.length>0&&table.columns.length<=64&&new Set(table.columns).size===table.columns.length&&table.columns.every(k=>/^[a-z][a-z0-9_]*$/.test(k)),'Invalid recovery columns.');
  demand(Array.isArray(table.primaryKey)&&table.primaryKey.every(k=>table.columns.includes(k))&&typeof table.hasRowid==='boolean','Invalid recovery key.');
  demand(Number.isSafeInteger(table.rowCount)&&table.rowCount>=0&&table.rowCount<=RECOVERY_LIMITS.tableRows&&isDigest(table.rowsDigest)&&Array.isArray(table.pages),'Recovery table bound.');
  demand(table.rowCount===0?table.pages.length===0:table.pages.length>0&&table.pages.length<=table.rowCount,'Invalid empty recovery pages.');
  for(const raw of table.pages){const i=privateIdentity(raw);demand(objects.has(i.key)&&canonicalJson(objects.get(i.key))===canonicalJson(i)&&!pageKeys.has(i.key),'Unlisted or duplicate recovery page.');pageKeys.add(i.key);}
 }
 if(value.mode==='public')demand(value.schema===null&&value.tables.length===0&&value.objects.length===publicKeys.size&&value.authPolicy==='no-private-state'&&canonicalJson(value.checkpoints)==='{}','Public inventory contains private state.');
 else{
  exact(value.schema,['migrations','fingerprint'],'recovery schema');demand(isDigest(value.schema.fingerprint)&&value.authPolicy==='revoke-sessions-and-fence-leases','Invalid private recovery policy.');
  demand(value.checkpoints&&typeof value.checkpoints==='object'&&!Array.isArray(value.checkpoints),'Invalid private checkpoints.');
 }
 // Includes every object re-read, table-page re-read, per-table SQL read and
 // public allocation reconciliation query, plus terminal bookkeeping margin.
 const finishOperations=16+value.objects.length+pageKeys.size+value.tables.length+value.publications.reduce((sum,p)=>sum+2+(value.mode==='public'?2+p.allocations.length:0),0);
 demand(finishOperations<=RECOVERY_LIMITS.finishOperations,'Recovery final reconciliation operation bound.');
}
export async function createPinnedInventory(input,crypto){
 const inventory=clone({format:RECOVERY_FORMAT,...input});validateInventory(inventory);
 if(inventory.schema){const schema=await schemaDescriptor(inventory.schema.migrations,crypto);demand(schema.fingerprint===inventory.schema.fingerprint,'Recovery schema fingerprint mismatch.');}
 const bytes=utf8(canonicalJson(inventory));demand(bytes.length<=RECOVERY_LIMITS.inventoryBytes,'Recovery inventory exceeds bound.');
 return {inventory,bytes,digest:await crypto.sha256(bytes)};
}
export async function verifyPinnedInventory(input,pinnedDigest,crypto){
 demand(isDigest(pinnedDigest),'Supply an independently retained recovery inventory digest.');
 const result=await createPinnedInventory(input,crypto);demand(result.digest===pinnedDigest,'Recovery inventory differs from independent pin.');return result.inventory;
}
export async function verifyObject(store,identity,crypto){
 identity=artifactIdentity(identity);const result=await store.getVerified(identity);
 if(result.status!=='verified')return {kind:'pending',reason:'recovery-object-'+result.status,objectKey:identity.key};
 const bytes=new Uint8Array(result.bytes);if(bytes.length!==identity.size||await crypto.sha256(bytes)!==identity.byteDigest)return {kind:'pending',reason:'recovery-object-conflict',objectKey:identity.key};
 return {kind:'verified',identity,bytes};
}
export async function persistObject(store,identity,bytes,crypto){
 identity=artifactIdentity(identity);bytes=new Uint8Array(bytes);demand(bytes.length===identity.size&&await crypto.sha256(bytes)===identity.byteDigest,'Invalid recovery object bytes.');
 const result=await store.putIfAbsent(identity,bytes);if(result.status==='unknown')return {kind:'pending',reason:'recovery-object-write-unknown',objectKey:identity.key};
 return verifyObject(store,identity,crypto);
}
