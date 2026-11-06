import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
const PAGE_BYTES=65536,ROOT_BYTES=131072,LIST_BYTES=16384;
const assert=(condition,message)=>{if(!condition)throw new TypeError(message);};
const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const wallet=value=>{try{return typeof value==='string'&&(decode58(value,32),true);}catch{return false;}};
const normalized=value=>JSON.parse(JSON.stringify(value,(_key,value)=>typeof value==='bigint'?{$lamports:value.toString()}:value));
const decoded=value=>JSON.parse(JSON.stringify(value),(_key,value)=>value&&typeof value==='object'&&Object.keys(value).length===1&&Object.hasOwn(value,'$lamports')?BigInt(value.$lamports):value);
function validate(state){
 assert(state&&id(state.id)&&['genesis','season'].includes(state.kind)&&integer(state.version,Number.MAX_SAFE_INTEGER),'Invalid collection source identity.');
 assert(state.slots===1000&&Array.isArray(state.stages)&&state.stages.length<=32&&Array.isArray(state.admissions)&&state.admissions.length<=1000,'Invalid collection source bounds.');
 assert(integer(state.fulfilled,state.admissions.length)&&Array.isArray(state.remaining)&&state.remaining.length===10&&state.remaining.every((n,i)=>integer(n,LEVEL_QUOTAS[i]))&&state.remaining.reduce((sum,n)=>sum+n,0)===1000-state.fulfilled,'Invalid remaining inventory.');
 const stages=new Set(),checkedWallets=new Set();
 const canonicalWallet=value=>{if(checkedWallets.has(value))return true;if(!wallet(value))return false;checkedWallets.add(value);return true;};
 for(const stage of state.stages){
  assert(id(stage.id)&&!stages.has(stage.id)&&['whitelist','free','public','founder'].includes(stage.type),'Invalid stage identity.');stages.add(stage.id);
  assert(stage.wallets===null||Array.isArray(stage.wallets)&&stage.wallets.length<=10000,'Invalid eligibility list.');
  if(stage.wallets===null)assert(stage.type==='public'||stage.type==='free','Missing immutable eligibility list.');
  else for(let i=0;i<stage.wallets.length;i++)assert(canonicalWallet(stage.wallets[i])&&(i===0||stage.wallets[i-1]<stage.wallets[i]),'Eligibility wallets must be canonical, unique and sorted.');
 }
 const operations=new Set(),commitments=new Set(),proofs=new Set();
 for(const row of state.admissions){
  assert(id(row.operationId)&&id(row.drawCommitment)&&stages.has(row.stageId)&&canonicalWallet(row.wallet)&&!operations.has(row.operationId)&&!commitments.has(row.drawCommitment),'Invalid admission identity.');
  assert(Object.keys(row).every(key=>['operationId','wallet','stageId','drawCommitment','admittedAt','costLamports','level','proofId','ticket'].includes(key))&&integer(row.admittedAt,8640000000000000)&&typeof row.costLamports==='bigint'&&row.costLamports>=0n&&row.costLamports<(1n<<64n),'Invalid bounded admission fields.');
  assert((row.level===null||integer(row.level,10)&&row.level>=1)&&(row.ticket===null||integer(row.ticket,999))&&(row.proofId===null||id(row.proofId)&&!proofs.has(row.proofId)),'Invalid draw outcome fields.');
  if(row.proofId!==null)proofs.add(row.proofId);
  operations.add(row.operationId);commitments.add(row.drawCommitment);
 }
 // Encoding is a format commitment, not approval of source economics or provenance.
 canonicalJson(normalized(state));
}

/** Full legacy conversion is an offline/import operation. Runtime intake verifies
 * one bounded immutable record at a time; it never stores full state in a receipt.
 * Content IDs hash canonical bytes. Existing terms/draw identities are unchanged. */
export function createCollectionStateCodec({crypto}){
 const hash=value=>crypto.sha256(utf8(canonicalJson(value)));
 async function record(body,max){const bytes=utf8(canonicalJson(body));assert(bytes.byteLength<=max,'Collection record exceeds byte bound.');return Object.freeze({id:await crypto.sha256(bytes),size:bytes.byteLength,bytes});}
 async function verifyRecord(input,expectedId=input.id){
  assert(input&&input.bytes instanceof Uint8Array&&digest(input.id)&&input.id===expectedId&&input.size===input.bytes.byteLength&&input.size<=ROOT_BYTES,'Invalid immutable record identity.');
  const bytes=input.bytes.slice();assert(await crypto.sha256(bytes)===expectedId,'Collection record byte digest mismatch.');
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));assert(canonicalJson(body)===new TextDecoder().decode(bytes),'Collection record is not canonical.');
  assert(['collection-page-v1','collection-list-v1','collection-source-v1'].includes(body.format),'Unknown collection source format.');
  if(body.format==='collection-page-v1')assert(bytes.byteLength<=PAGE_BYTES&&['eligibility','admissions'].includes(body.kind)&&integer(body.index,99)&&Array.isArray(body.entries)&&body.entries.length<=100,'Invalid source page.');
  if(body.format==='collection-list-v1')assert(bytes.byteLength<=LIST_BYTES&&integer(body.count,10000)&&body.pageCount===Math.max(1,Math.ceil(body.count/100))&&Array.isArray(body.pageIds)&&body.pageIds.length===body.pageCount&&body.pageIds.every(digest)&&digest(body.walletsDigest),'Invalid list manifest.');
  if(body.format==='collection-source-v1')assert(body.source&&id(body.source.inventoryId)&&typeof body.source.revision==='string'&&/^(0|[1-9]\d*)$/.test(body.source.revision)&&digest(body.source.stateDigest)&&body.inventory&&Array.isArray(body.stages)&&body.stages.length<=32&&body.admissions&&integer(body.admissions.count,1000)&&Array.isArray(body.admissions.pageIds)&&body.admissions.pageIds.length<=16&&body.admissions.pageIds.every(digest),'Invalid source root.');
  return body;
 }
 async function encodeWalletList(input){
  const wallets=structuredClone(input);assert(Array.isArray(wallets)&&wallets.length<=10000,'Invalid eligibility list.');
  for(let index=0;index<wallets.length;index++)assert(wallet(wallets[index])&&(index===0||wallets[index-1]<wallets[index]),'Eligibility wallets must be canonical, unique and sorted.');
  return encodeList(wallets,await hash(wallets));
 }
 async function encodeList(wallets,walletsDigest){
  const pages=[];for(let offset=0;offset<Math.max(1,wallets.length);offset+=100)pages.push(await record({format:'collection-page-v1',kind:'eligibility',index:offset/100,entries:wallets.slice(offset,offset+100)},PAGE_BYTES));
  const manifest=await record({format:'collection-list-v1',count:wallets.length,pageCount:pages.length,pageIds:pages.map(page=>page.id),walletsDigest},LIST_BYTES);
  return Object.freeze({manifest,pages});
 }
 async function encodeReferenceInventory(input){
  // Capture before the first asynchronous digest; callers cannot mutate a source in flight.
  const state=structuredClone(input);validate(state);const value=normalized(state),pages=new Map(),lists=new Map(),knownLists=new Map();
  async function page(kind,index,entries){const entry=await record({format:'collection-page-v1',kind,index,entries},PAGE_BYTES);pages.set(entry.id,entry);return entry.id;}
  const stages=[];
  for(const stage of value.stages){
   const {wallets,...terms}=stage;let eligibility;
   if(wallets===null)eligibility={kind:stage.type==='public'?'unrestricted':'pending',manifestId:null};
   else{
    const walletsDigest=await hash(wallets);let listId=knownLists.get(walletsDigest);
    if(!listId){
     const {manifest:list,pages:listPages}=await encodeList(wallets,walletsDigest);for(const item of listPages)pages.set(item.id,item);
     lists.set(list.id,list);listId=list.id;knownLists.set(walletsDigest,listId);
    }
    eligibility={kind:'list',manifestId:listId};
   }
   stages.push({terms,eligibility});
  }
  const pageIds=[];let entries=[],payloadBytes=0;
  const overhead=()=>utf8(canonicalJson({format:'collection-page-v1',kind:'admissions',index:pageIds.length,entries:[]})).byteLength;
  for(const entry of value.admissions){
   const size=utf8(canonicalJson(entry)).byteLength;
   if(entries.length===100||entries.length&&overhead()+payloadBytes+entries.length+size>PAGE_BYTES){pageIds.push(await page('admissions',pageIds.length,entries));entries=[];payloadBytes=0;}
   assert(overhead()+size<=PAGE_BYTES,'One admission exceeds the page bound.');entries.push(entry);payloadBytes+=size;
  }
  if(entries.length)pageIds.push(await page('admissions',pageIds.length,entries));assert(pageIds.length<=16,'Admission page bound exceeded.');
  const {stages:ignoredStages,admissions:ignoredAdmissions,...inventory}=value;
  const root=await record({format:'collection-source-v1',source:{inventoryId:value.id,revision:String(value.version),stateDigest:await hash(value)},inventory,stages,admissions:{count:value.admissions.length,pageIds}},ROOT_BYTES);
  return Object.freeze({root,listManifests:[...lists.values()],pages:[...pages.values()]});
 }
 async function decodeReferenceInventory(input){
  // This is the bounded offline parity/import verifier, not an HTTP read model.
  assert(Array.isArray(input.pages)&&input.pages.length<=3216&&Array.isArray(input.listManifests)&&input.listManifests.length<=32,'Source bundle exceeds record bound.');
  assert([input.root,...input.pages,...input.listManifests].every(record=>record?.bytes instanceof Uint8Array)&&[input.root,...input.pages,...input.listManifests].reduce((sum,record)=>sum+record.bytes.byteLength,0)<=32*1024*1024,'Source bundle exceeds offline byte bound.');
  const bundle=structuredClone(input);
  const root=await verifyRecord(bundle.root),pages=new Map(),lists=new Map();assert(root.format==='collection-source-v1','Expected collection source root.');
  for(const entry of bundle.pages){assert(!pages.has(entry.id),'Duplicate page record.');const page=await verifyRecord(entry);assert(page.format==='collection-page-v1','Expected source page.');pages.set(entry.id,page);}
  for(const entry of bundle.listManifests){assert(!lists.has(entry.id),'Duplicate list record.');const list=await verifyRecord(entry);assert(list.format==='collection-list-v1','Expected list manifest.');lists.set(entry.id,list);}
  const usedPages=new Set(),usedLists=new Set(),decodedLists=new Map();
  function entries(ids,kind){return ids.flatMap((id,index)=>{const page=pages.get(id);assert(page&&page.kind===kind&&page.index===index,'Missing, reordered or wrong-kind source page.');assert(kind==='eligibility'?(index===ids.length-1||page.entries.length===100):page.entries.length>0,'Invalid source page partition.');usedPages.add(id);return page.entries;});}
  const stages=[];
  for(const stage of root.stages){
   let wallets=null;
   if(stage.eligibility?.kind==='list'){
    const list=lists.get(stage.eligibility.manifestId);assert(list,'Missing list manifest.');usedLists.add(stage.eligibility.manifestId);
    wallets=decodedLists.get(stage.eligibility.manifestId);
    if(!wallets){wallets=entries(list.pageIds,'eligibility');assert(wallets.length===list.count&&await hash(wallets)===list.walletsDigest,'Eligibility count or digest mismatch.');decodedLists.set(stage.eligibility.manifestId,wallets);}
   }else assert(stage.eligibility?.manifestId===null&&(stage.eligibility.kind==='unrestricted'&&stage.terms.type==='public'||stage.eligibility.kind==='pending'&&stage.terms.type==='free'),'Invalid pending or unrestricted eligibility.');
   stages.push({...stage.terms,wallets});
  }
  const admissions=entries(root.admissions.pageIds,'admissions');assert(admissions.length===root.admissions.count,'Admission count mismatch.');
  assert(usedPages.size===pages.size&&usedLists.size===lists.size,'Unreferenced collection source record.');
  const value={...root.inventory,stages,admissions};assert(root.source.inventoryId===value.id&&root.source.revision===String(value.version)&&await hash(value)===root.source.stateDigest,'Collection source semantic digest mismatch.');
  const state=decoded(value);validate(state);return state;
 }
 return Object.freeze({encodeReferenceInventory,decodeReferenceInventory,encodeWalletList,verifyRecord});
}
