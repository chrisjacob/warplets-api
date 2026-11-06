import {canonicalJson,utf8} from '../security/canonical.mjs';
import {artifactIdentity,privateIdentity} from '../artifacts/identity.mjs';
import {schemaDescriptor} from './inventory.mjs';
/** A bounded structural codec only. Readiness additionally requires durable
 * source fencing, complete graph traversal and target reconciliation. V1 is
 * unchanged. These aggregate ceilings never authorize aggregate hydration. */
export const RECOVERY_V2_LIMITS=Object.freeze({rootBytes:262144,indexBytes:131072,pageBytes:131072,sourcePageBytes:196608,pageRows:100,indexEntries:100,indexLevels:8,tableRows:65536,tables:128,objects:16384,totalBytes:134217728,stepOperations:64,stepWorkingBytes:1048576,publicStepWorkingBytes:4194304});
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),name=value=>typeof value==='string'&&/^[a-z][a-z0-9_]*$/.test(value);
const nat=(value,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const text=(value,max=256)=>typeof value==='string'&&value.length>0&&value.length<=max&&value.trim()===value;
const cell=value=>value===null||typeof value==='string'||Number.isSafeInteger(value);
function need(value,message){if(!value)throw new TypeError(message);}
function exact(value,keys,label){need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),'Invalid v2 '+label+' fields.');}
const clone=value=>JSON.parse(canonicalJson(value));
function identity(value){const normalized=privateIdentity(value);need(normalized.contentType==='application/json'&&normalized.semanticDigest===null,'V2 metadata requires private JSON byte identity.');need(canonicalJson(value)===canonicalJson(normalized),'Invalid v2 object identity fields.');return normalized;}
function dataIdentity(value){const normalized=artifactIdentity(value);need(canonicalJson(value)===canonicalJson(normalized),'Invalid v2 data identity fields.');return normalized;}
function cursor(value){need(value===null||Array.isArray(value)&&value.length>0&&value.length<=64&&value.every(v=>typeof v==='string'||Number.isSafeInteger(v))&&utf8(canonicalJson(value)).length<=4096,'Invalid v2 cursor.');}
function pointer(value,max){exact(value,['identity','count'],'index pointer');need(nat(value.count,max)&&(value.count===0?value.identity===null:value.identity!==null),'Invalid v2 index count.');if(value.identity!==null)identity(value.identity);}
function columns(value){need(Array.isArray(value)&&value.length>0&&value.length<=64&&new Set(value).size===value.length&&value.every(name),'Invalid v2 columns.');}
function table(value){
 exact(value,['name','columns','primaryKey','hasRowid','rowCount','pages','tableDigest'],'table descriptor');need(name(value.name),'Invalid v2 table name.');columns(value.columns);need(Array.isArray(value.primaryKey)&&value.primaryKey.length<=64&&new Set(value.primaryKey).size===value.primaryKey.length&&value.primaryKey.every(key=>value.columns.includes(key))&&typeof value.hasRowid==='boolean'&&(value.hasRowid||value.primaryKey.length>0),'Invalid v2 table key.');
 need(nat(value.rowCount,RECOVERY_V2_LIMITS.tableRows)&&digest(value.tableDigest),'Invalid v2 table commitment.');pointer(value.pages,RECOVERY_V2_LIMITS.objects);need(value.rowCount===0?value.pages.count===0:value.pages.count>0&&value.pages.count<=value.rowCount,'Invalid v2 table page count.');
}
function rowPage(value){
 exact(value,['format','table','index','columns','hasRowid','after','rows'],'row page');need(value.format==='10x.local.recovery.rows.v2'&&name(value.table)&&nat(value.index,RECOVERY_V2_LIMITS.objects-1)&&typeof value.hasRowid==='boolean','Invalid v2 row page header.');columns(value.columns);cursor(value.after);need(value.index===0?value.after===null:value.after!==null,'Invalid v2 page boundary.');
 need(Array.isArray(value.rows)&&value.rows.length>0&&value.rows.length<=RECOVERY_V2_LIMITS.pageRows&&value.rows.every(row=>Array.isArray(row)&&row.length===value.columns.length+Number(value.hasRowid)&&row.every(cell)),'Invalid v2 row values.');
 if(value.hasRowid){need(value.after===null||value.after.length===1&&Number.isSafeInteger(value.after[0]),'Invalid v2 rowid cursor.');let previous=value.after?.[0]??null;for(const row of value.rows){need(Number.isSafeInteger(row[0])&&(previous===null||row[0]>previous),'Unordered v2 rowids.');previous=row[0];}}
 need(utf8(canonicalJson(value)).length<=(value.table==='app_collection_records'?RECOVERY_V2_LIMITS.sourcePageBytes:RECOVERY_V2_LIMITS.pageBytes),'V2 row page byte bound.');
}
function publication(value){exact(value,['identity','semanticDigest','boardId','epoch','allocations'],'publication pin');const i=dataIdentity(value.identity);need(i.visibility==='public'&&i.contentType==='application/json'&&i.semanticDigest===value.semanticDigest&&digest(value.semanticDigest)&&digest(value.boardId)&&nat(value.epoch),'Invalid v2 public publication.');need(Array.isArray(value.allocations)&&value.allocations.length<=32,'V2 publication allocation bound.');for(const a of value.allocations){exact(a,['tokenId','day','allocationId','awardRoot'],'allocation pin');need(text(a.tokenId)&&nat(a.day,10)&&a.day>=1&&digest(a.allocationId)&&digest(a.awardRoot),'Invalid v2 allocation pin.');}}
function leaf(kind,entry){
 exact(entry,['key','value'],'index leaf');need(text(entry.key),'Invalid v2 index key.');
 if(kind==='tables'){table(entry.value);need(entry.key===entry.value.name,'V2 table index key mismatch.');}
 if(kind==='objects'){const i=dataIdentity(entry.value);need(entry.key===i.key,'V2 object index key mismatch.');}
 if(kind==='table-pages'){const p=entry.value;exact(p,['identity','index','rowCount','after','last'],'table page entry');identity(p.identity);need(nat(p.index,RECOVERY_V2_LIMITS.objects-1)&&entry.key===String(p.index).padStart(10,'0')&&nat(p.rowCount,100)&&p.rowCount>0,'Invalid v2 page index leaf.');cursor(p.after);cursor(p.last);need(p.last!==null&&(p.index===0?p.after===null:p.after!==null),'Invalid v2 page leaf cursors.');}
 if(kind==='publications'){publication(entry.value);need(entry.key===entry.value.identity.key,'V2 publication key mismatch.');}
}
function indexNode(value){
 exact(value,['format','kind','level','entries'],'index node');need(value.format==='10x.local.recovery.index.v2'&&['tables','table-pages','objects','publications'].includes(value.kind)&&nat(value.level,RECOVERY_V2_LIMITS.indexLevels-1),'Invalid v2 index header.');need(Array.isArray(value.entries)&&value.entries.length>0&&value.entries.length<=RECOVERY_V2_LIMITS.indexEntries,'V2 index fanout bound.');let previous=null,total=0;
 for(const entry of value.entries){let first,last,count;if(value.level===0){leaf(value.kind,entry);first=last=entry.key;count=1;}else{exact(entry,['first','last','count','identity'],'index branch');need(text(entry.first)&&text(entry.last)&&entry.first<=entry.last&&nat(entry.count,RECOVERY_V2_LIMITS.objects)&&entry.count>0,'Invalid v2 branch range.');identity(entry.identity);({first,last,count}=entry);}need(previous===null||previous<first,'Overlapping or unordered v2 index ranges.');previous=last;total+=count;}
 need(total<=RECOVERY_V2_LIMITS.objects&&utf8(canonicalJson(value)).length<=RECOVERY_V2_LIMITS.indexBytes,'V2 index count or byte bound.');
}
function root(value){
 exact(value,['format','mode','createdMs','sourceCommit','schema','snapshot','tables','objects','publications','checkpoints','totals','authPolicy'],'root');need(value.format==='10x.local.recovery.v2'&&value.mode==='private'&&nat(value.createdMs,8640000000000000)&&/^[a-f0-9]{40}$/.test(value.sourceCommit)&&value.authPolicy==='revoke-sessions-and-fence-leases','Invalid v2 root identity.');
 exact(value.schema,['migrations','fingerprint'],'schema');need(digest(value.schema.fingerprint),'Invalid v2 schema digest.');exact(value.snapshot,['generation','watermark'],'snapshot');need(text(value.snapshot.generation)&&typeof value.snapshot.watermark==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(value.snapshot.watermark)&&BigInt(value.snapshot.watermark)<=BigInt(Number.MAX_SAFE_INTEGER),'Invalid v2 source snapshot.');
 pointer(value.tables,RECOVERY_V2_LIMITS.tables);need(value.tables.count>0,'V2 private table inventory required.');pointer(value.objects,RECOVERY_V2_LIMITS.objects);pointer(value.publications,4096);identity(value.checkpoints);
 exact(value.totals,['rows','objects','bytes'],'totals');need(nat(value.totals.rows,RECOVERY_V2_LIMITS.tables*RECOVERY_V2_LIMITS.tableRows)&&nat(value.totals.objects,RECOVERY_V2_LIMITS.objects)&&value.totals.objects>0&&nat(value.totals.bytes,RECOVERY_V2_LIMITS.totalBytes)&&value.totals.bytes>0,'V2 aggregate inventory bound.');need(utf8(canonicalJson(value)).length<=RECOVERY_V2_LIMITS.rootBytes,'V2 root byte bound.');
}
function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
export function recoveryV2IndexSummary(input,rawIdentity){const value=clone(input),i=identity(clone(rawIdentity));indexNode(value);const first=value.entries[0],last=value.entries.at(-1);return freeze({first:value.level===0?first.key:first.first,last:value.level===0?last.key:last.last,count:value.level===0?value.entries.length:value.entries.reduce((sum,e)=>sum+e.count,0),identity:i});}
/** Use only after verifyIndex has verified both byte identities. This binds a
 * single continued traversal edge without loading other index nodes. */
export function verifyRecoveryV2IndexChild(parentInput,entryInput,childInput,childIdentity){const parent=clone(parentInput),entry=clone(entryInput),child=clone(childInput);indexNode(parent);indexNode(child);need(parent.level>0&&child.kind===parent.kind&&child.level===parent.level-1&&parent.entries.some(e=>canonicalJson(e)===canonicalJson(entry)),'V2 index child type or level mismatch.');need(canonicalJson(recoveryV2IndexSummary(child,childIdentity))===canonicalJson(entry),'V2 index child range or count mismatch.');return true;}
export function createRecoveryV2Codec({crypto}){
 async function object(input,validate){const value=clone(input);validate(value);const bytes=utf8(canonicalJson(value)),byteDigest=await crypto.sha256(bytes),i=identity({key:'private/'+byteDigest+'.json',byteDigest,semanticDigest:null,size:bytes.length,visibility:'private',contentType:'application/json'});return {value:freeze(value),bytes,identity:freeze(i)};}
 async function verified(input,rawIdentity,validate){const bytes=new Uint8Array(input),i=identity(clone(rawIdentity));need(bytes.length===i.size&&await crypto.sha256(bytes)===i.byteDigest,'V2 object byte identity mismatch.');const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);need(canonicalJson(value)===text,'V2 object is not canonical JSON.');validate(value);return freeze(value);}
 async function descriptor(input){const value=clone(input);exact(value,['name','columns','primaryKey','hasRowid','rowCount','pages'],'table descriptor input');table({...value,tableDigest:'0'.repeat(64)});const tableDigest=await crypto.sha256(utf8(canonicalJson(['10x.local.recovery.table.v2',value]))),result={...value,tableDigest};return freeze(result);}
 return Object.freeze({encodeRows:value=>object(value,rowPage),encodeIndex:value=>object(value,indexNode),verifyRows:(bytes,i)=>verified(bytes,i,rowPage),verifyIndex:(bytes,i)=>verified(bytes,i,indexNode),tableDescriptor:descriptor,
  async verifyTableDescriptor(input){const value=clone(input);table(value);const {tableDigest,...rest}=value;need((await descriptor(rest)).tableDigest===tableDigest,'V2 table descriptor digest mismatch.');return freeze(value);},
  async encodeRoot(input){const value=clone(input);root(value);need((await schemaDescriptor(value.schema.migrations,crypto)).fingerprint===value.schema.fingerprint,'V2 schema fingerprint mismatch.');const bytes=utf8(canonicalJson(value));return {value:freeze(value),bytes,digest:await crypto.sha256(bytes)};},
  async verifyRoot(input,pin){const bytes=new Uint8Array(input);need(bytes.length<=RECOVERY_V2_LIMITS.rootBytes&&digest(pin)&&await crypto.sha256(bytes)===pin,'V2 independently pinned root mismatch.');const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);need(canonicalJson(value)===text,'V2 root is not canonical JSON.');root(value);need((await schemaDescriptor(value.schema.migrations,crypto)).fingerprint===value.schema.fingerprint,'V2 schema fingerprint mismatch.');return freeze(value);},
 });
}
