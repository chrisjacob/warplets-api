import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
import {createCollectionStateCodec} from './state-codec.mjs';
export const STAGE_COLLECTION_RECORD='collection.stage-record.v1',SEAL_COLLECTION_LIST='collection.seal-list.v1',SEAL_COLLECTION_SOURCE='collection.seal-source.v1';
export const COLLECTION_INTAKE_BOUNDS=Object.freeze({recordBytes:131072,pageBytes:65536,listBytes:16384,listReadBytes:524288,sourceReadBytes:2097152,sourceSealBytes:32768,listPages:100,sourceLists:32,admissionPages:16,admissions:1000});
const fail=(condition,message)=>{if(!condition)throw new TypeError(message);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const nat=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const decimal=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v);
const frozen=v=>{if(v&&typeof v==='object'){for(const c of Object.values(v))frozen(c);Object.freeze(v);}return v;};
const clone=v=>JSON.parse(canonicalJson(v));
const wallet=v=>{fail(typeof v==='string'&&v.length<=44,'Invalid eligibility wallet.');try{decode58(v,32);}catch{throw new TypeError('Invalid eligibility wallet.');}return v;};
const amount=v=>exact(v,['$lamports'])&&decimal(v.$lamports)&&BigInt(v.$lamports)<(1n<<64n);
const hash=(crypto,value)=>crypto.sha256(utf8(canonicalJson(value)));
function base64(bytes){let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(binary);}
function captureRecord(value){
 fail(exact(value,['id','size','bytes'])&&digest(value.id)&&nat(value.size,131072)&&value.size>0&&value.bytes instanceof Uint8Array&&value.bytes.length===value.size,'Invalid collection record identity or byte bound.');
 return {id:value.id,size:value.size,bytes:value.bytes.slice()};
}
function captureRecords(values,max,totalBytes){
 fail(Array.isArray(values)&&values.length<=max,'Collection named-record count exceeds bound.');
 // Inspect sizes before copying potentially hostile retained records.
 fail(values.every(v=>v?.bytes instanceof Uint8Array&&nat(v.size,131072)&&v.bytes.length===v.size)&&values.reduce((n,v)=>n+v.size,0)<=totalBytes,'Collection named-record bytes exceed bound.');
 return values.map(captureRecord);
}
function named(values,ids,label){
 fail(new Set(ids).size===ids.length&&values.length===ids.length,'Missing, duplicate or extra '+label+'.');
 const map=new Map();for(const value of values){fail(digest(value.id)&&ids.includes(value.id)&&!map.has(value.id),'Missing, duplicate or extra '+label+'.');map.set(value.id,value);}return map;
}
function admission(row){
 fail(exact(row,['operationId','wallet','stageId','drawCommitment','admittedAt','costLamports','level','proofId','ticket'])&&id(row.operationId)&&id(row.stageId)&&id(row.drawCommitment)&&nat(row.admittedAt,8640000000000000)&&amount(row.costLamports),'Invalid admission fields.');wallet(row.wallet);
 const pending=row.level===null&&row.proofId===null&&row.ticket===null;
 fail(pending||nat(row.level,10)&&row.level>0&&id(row.proofId)&&nat(row.ticket,999),'Incomplete or invalid admission outcome.');
}
function shape(body){
 if(body.format==='collection-page-v1'){
  fail(exact(body,['format','kind','index','entries']),'Unexpected source page fields.');
  if(body.kind==='eligibility')for(let n=0;n<body.entries.length;n++){wallet(body.entries[n]);fail(n===0||body.entries[n-1]<body.entries[n],'Eligibility page must be sorted and unique.');}
  else for(const row of body.entries)admission(row);
 }else if(body.format==='collection-list-v1')fail(exact(body,['format','count','pageCount','pageIds','walletsDigest'])&&new Set(body.pageIds).size===body.pageIds.length,'Unexpected or repeated list fields.');
 else{
  fail(exact(body,['format','source','inventory','stages','admissions'])&&exact(body.source,['inventoryId','revision','stateDigest'])&&exact(body.admissions,['count','pageIds']),'Unexpected collection root fields.');
  const inventory=body.inventory;
  fail(object(inventory)&&Object.keys(inventory).every(k=>['id','kind','tranche','version','slots','remaining','fulfilled'].includes(k))&&id(inventory.id)&&['genesis','season'].includes(inventory.kind)&&nat(inventory.version)&&inventory.slots===1000&&nat(inventory.fulfilled,1000),'Invalid collection header.');
  fail(inventory.kind==='genesis'?nat(inventory.tranche,10)&&inventory.tranche>0:inventory.tranche===undefined||inventory.tranche===null,'Invalid collection tranche.');
  fail(Array.isArray(inventory.remaining)&&inventory.remaining.length===10&&inventory.remaining.every((n,i)=>nat(n,LEVEL_QUOTAS[i]))&&inventory.remaining.reduce((a,b)=>a+b,0)===1000-inventory.fulfilled,'Invalid remaining inventory.');
  fail(body.source.inventoryId===inventory.id&&body.source.revision===String(inventory.version),'Collection header/source identity mismatch.');
  fail(new Set(body.admissions.pageIds).size===body.admissions.pageIds.length&&(body.admissions.count===0?body.admissions.pageIds.length===0:body.admissions.pageIds.length>0),'Invalid admission page references.');
  const stages=new Set();for(const stage of body.stages){
   fail(exact(stage,['terms','eligibility'])&&object(stage.terms)&&id(stage.terms.id)&&!stages.has(stage.terms.id)&&['whitelist','free','public','founder'].includes(stage.terms.type),'Invalid or duplicate source stage.');stages.add(stage.terms.id);
   fail(exact(stage.eligibility,['kind','manifestId']),'Invalid eligibility descriptor.');
   const e=stage.eligibility;
   fail(e.kind==='list'?digest(e.manifestId):e.manifestId===null&&(e.kind==='pending'&&stage.terms.type==='free'||e.kind==='unrestricted'&&stage.terms.type==='public'),'Invalid eligibility binding.');
  }
 }
 return body;
}
async function document(record,crypto){return shape(await createCollectionStateCodec({crypto}).verifyRecord(record,record.id));}

/** Format/byte verification only; no source economics or publication approval. */
export async function prepareCollectionRecord(value,crypto){
 const record=captureRecord(value),body=await document(record,crypto);
 return frozen({id:record.id,size:record.size,format:body.format,kind:body.format==='collection-page-v1'?body.kind:null,pageIndex:body.format==='collection-page-v1'?body.index:null,bodyBase64:base64(record.bytes)});
}
const listPayload=s=>['collection-list-closure-v1',s.id,s.count,s.pageIds,s.walletsDigest,s.firstWallet,s.lastWallet];
/** Shared historical verification; does not approve a caller-supplied list. */
export function collectionListClosureDigest(value,crypto){return hash(crypto,listPayload(clone(value)));}
function captureListSeals(values){
 fail(Array.isArray(values)&&values.length<=32,'Sealed-list count exceeds bound.');
 for(const s of values)fail(exact(s,['id','count','pageIds','walletsDigest','closureDigest','firstWallet','lastWallet'])&&digest(s.id)&&nat(s.count,10000)&&Array.isArray(s.pageIds)&&s.pageIds.length<=100&&s.pageIds.every(digest)&&digest(s.walletsDigest)&&digest(s.closureDigest)&&(s.firstWallet===null||typeof s.firstWallet==='string'&&s.firstWallet.length<=44)&&(s.lastWallet===null||typeof s.lastWallet==='string'&&s.lastWallet.length<=44),'Invalid sealed list metadata.');
 fail(utf8(canonicalJson(values)).length<=262144,'Sealed-list metadata exceeds bound.');return clone(values);
}
async function checkedListSeal(value,crypto){
 const s=clone(value);fail(exact(s,['id','count','pageIds','walletsDigest','closureDigest','firstWallet','lastWallet'])&&digest(s.id)&&nat(s.count,10000)&&Array.isArray(s.pageIds)&&s.pageIds.length===Math.max(1,Math.ceil(s.count/100))&&s.pageIds.every(digest)&&new Set(s.pageIds).size===s.pageIds.length&&digest(s.walletsDigest)&&digest(s.closureDigest),'Invalid sealed list metadata.');
 if(s.count===0)fail(s.firstWallet===null&&s.lastWallet===null,'Invalid empty list boundaries.');else{wallet(s.firstWallet);wallet(s.lastWallet);fail(s.firstWallet<=s.lastWallet,'Invalid list boundaries.');}
 fail(await collectionListClosureDigest(s,crypto)===s.closureDigest,'Changed list seal metadata.');return s;
}
export async function prepareCollectionList(value,crypto){
 fail(exact(value,['manifest','pages']),'Supply list manifest and named pages only.');const manifest=captureRecord(value.manifest),pages=captureRecords(value.pages,100,524288-manifest.size);
 const body=await document(manifest,crypto);fail(body.format==='collection-list-v1','Expected eligibility list manifest.');const byId=named(pages,body.pageIds,'eligibility pages'),wallets=[];
 for(const [index,pageId] of body.pageIds.entries()){
  const page=await document(byId.get(pageId),crypto);fail(page.format==='collection-page-v1'&&page.kind==='eligibility'&&page.index===index,'Missing, reordered or cross-kind eligibility page.');
  const count=index<body.pageIds.length-1?100:body.count-index*100;fail(page.entries.length===count,'Invalid eligibility partition or count.');
  for(const item of page.entries){fail(wallets.length===0||wallets.at(-1)<item,'Eligibility list must be globally sorted and unique.');wallets.push(item);}
 }
 fail(wallets.length===body.count&&await hash(crypto,wallets)===body.walletsDigest,'Eligibility count or complete-list digest mismatch.');
 const seal={id:manifest.id,count:body.count,pageIds:[...body.pageIds],walletsDigest:body.walletsDigest,firstWallet:wallets[0]??null,lastWallet:wallets.at(-1)??null};
 return frozen({...seal,closureDigest:await collectionListClosureDigest(seal,crypto)});
}
export async function prepareCollectionSource(value,crypto){
 fail(exact(value,['root','lists','admissionPages'])&&Array.isArray(value.lists)&&value.lists.length<=32,'Supply bounded root, sealed lists and admission pages only.');
 const root=captureRecord(value.root),lists=captureListSeals(value.lists),admissionPages=captureRecords(value.admissionPages,16,2097152-root.size-utf8(canonicalJson(lists)).length);
 const body=await document(root,crypto);fail(body.format==='collection-source-v1','Expected collection root.');
 const listIds=[...new Set(body.stages.filter(s=>s.eligibility.kind==='list').map(s=>s.eligibility.manifestId))].sort(),byList=named(lists,listIds,'sealed lists');
 const seals=[];for(const listId of listIds)seals.push(await checkedListSeal(byList.get(listId),crypto));
 const pages=named(admissionPages,body.admissions.pageIds,'admission pages'),stages=new Set(body.stages.map(s=>s.terms.id)),operations=new Set(),commitments=new Set(),proofs=new Set(),fulfilledByLevel=Array(10).fill(0);let count=0,fulfilled=0;
 for(const [index,pageId] of body.admissions.pageIds.entries()){
  const page=await document(pages.get(pageId),crypto);fail(page.format==='collection-page-v1'&&page.kind==='admissions'&&page.index===index&&page.entries.length>0,'Missing, reordered or cross-kind admission page.');
  for(const row of page.entries){
   fail(++count<=1000&&stages.has(row.stageId)&&!operations.has(row.operationId)&&!commitments.has(row.drawCommitment),'Invalid admission count, stage or duplicate identity.');operations.add(row.operationId);commitments.add(row.drawCommitment);
   if(row.proofId!==null){fail(!proofs.has(row.proofId),'Duplicate admission proof.');proofs.add(row.proofId);fulfilled++;fulfilledByLevel[row.level-1]++;}
  }
 }
 fail(count===body.admissions.count&&fulfilled===body.inventory.fulfilled&&body.inventory.remaining.every((n,i)=>n===LEVEL_QUOTAS[i]-fulfilledByLevel[i]),'Admission count or retained inventory outcome mismatch.');
 const seal={id:root.id,inventoryId:body.source.inventoryId,sourceRevision:body.source.revision,declaredStateDigest:body.source.stateDigest,stageCount:body.stages.length,admissionCount:count,
  stageBindings:body.stages.map(s=>({stageId:s.terms.id,listId:s.eligibility.manifestId,eligibilityKind:s.eligibility.kind})),admissionPageIds:[...body.admissions.pageIds],listIds,
  verification:'record-closure-only',semanticStateDigestVerified:false,economicsVerified:false,provenanceVerified:false};
 const result={...seal,closureDigest:await hash(crypto,['collection-source-closure-v1',seal,seals.map(s=>[s.id,s.closureDigest])])};
 fail(utf8(canonicalJson(result)).length<=32768,'Collection source seal exceeds compact bound.');return frozen(result);
}
export function collectionIntakeCommandBytes(command){return utf8(canonicalJson([command.operationKind,command.principal,command.businessIdentity,command.requestKey,command.expectedRevisions,command.input]));}
function request(principal,value,record){
 const p=clone(principal);fail(exact(p,['kind','id'])&&p.kind==='operator'&&id(p.id),'Collection intake requires an operator principal.');
 fail(object(value)&&Object.keys(value).every(k=>['requestKey','expectedRevisions',record?'record':'id'].includes(k))&&id(value.requestKey),'Invalid collection intake request.');
 const revisions=clone(value.expectedRevisions??{});fail(Object.keys(revisions).every(k=>['source','control','earn'].includes(k)&&decimal(revisions[k])),'Invalid expected source revisions.');
 const captured=record?captureRecord(value.record):value.id;fail(record||digest(captured),'Invalid source record identity.');return {principal:p,requestKey:value.requestKey,expectedRevisions:revisions,value:captured};
}
export function createCollectionSourceIntake({repository,crypto,clock}){
 async function command(kind,captured,recordId){
  const c={operationKind:kind,principal:captured.principal,businessIdentity:recordId,input:{id:recordId},requestKey:captured.requestKey,expectedRevisions:captured.expectedRevisions,nowMs:clock.nowMs()};fail(nat(c.nowMs,8640000000000000),'Invalid intake clock.');
  return frozen({...c,requestDigest:await crypto.sha256(collectionIntakeCommandBytes(c))});
 }
 async function one(recordId){const values=await repository.readRecords([recordId]);const records=captureRecords(values,1,131072);return named(records,[recordId],'source records').get(recordId);}
 return Object.freeze({
  async stageRecord(principal,value){const c=request(principal,value,true),verified=await prepareCollectionRecord(c.value,crypto);return repository.stageRecord(await command(STAGE_COLLECTION_RECORD,c,verified.id),c.value);},
  async sealList(principal,value){const c=request(principal,value,false),manifest=await one(c.value),body=await document(manifest,crypto);fail(body.format==='collection-list-v1','Expected eligibility manifest.');
   const pages=await repository.readRecords([...body.pageIds]),seal=await prepareCollectionList({manifest,pages},crypto);return repository.sealList(await command(SEAL_COLLECTION_LIST,c,seal.id),seal);},
  async sealSource(principal,value){const c=request(principal,value,false),root=await one(c.value),body=await document(root,crypto);fail(body.format==='collection-source-v1','Expected collection source root.');
   const ids=[...new Set(body.stages.filter(s=>s.eligibility.kind==='list').map(s=>s.eligibility.manifestId))].sort();
   const [lists,admissionPages]=await Promise.all([repository.readListSeals(ids),repository.readRecords([...body.admissions.pageIds])]);
   const seal=await prepareCollectionSource({root,lists,admissionPages},crypto);return repository.sealSource(await command(SEAL_COLLECTION_SOURCE,c,seal.id),seal);},
 });
}
