import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {prepareCollectionList} from '../collect/source-intake.mjs';
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const pending=(reason,ids)=>({kind:'pending',reason,dependencyIds:ids});
const chunks=(values,n)=>Array.from({length:Math.ceil(values.length/n)},(_,i)=>values.slice(i*n,(i+1)*n));
/** At most three immutable list closures. Raw record bytes are size-checked
 * before hydration; each list is independently verified against its seal and
 * the exact private SQL index. Nothing here establishes source provenance. */
export async function readGovernanceElectorates(read,ids,crypto){
 const unique=[...new Set(ids)];if(unique.length>3||!unique.every(digest))throw new TypeError('Invalid bounded electorate selection.');
 const [rows]=await read([sql('SELECT * FROM app_collection_list_seals WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',canonicalJson(unique))]);
 if(rows.length!==unique.length)return pending('electorate-seal-missing',unique.filter(id=>!rows.some(row=>row.id===id)));
 const selected=new Map();
 for(const row of rows){
  let pageIds;try{pageIds=JSON.parse(row.page_ids_json);}catch{return pending('electorate-source-invalid',[row.id]);}
  if(!Array.isArray(pageIds)||pageIds.length<1||pageIds.length>100||!pageIds.every(digest)||new Set(pageIds).size!==pageIds.length)return pending('electorate-source-invalid',[row.id]);
  const keys=[row.id,...pageIds],[metadata]=await read([sql('SELECT id,size,length(body_base64) AS encoded_size FROM app_collection_records WHERE id IN (SELECT value FROM json_each(?))',canonicalJson(keys))]);
  if(metadata.length!==keys.length)return pending('electorate-record-missing',keys.filter(id=>!metadata.some(record=>record.id===id)));
  if(metadata.some(record=>!Number.isSafeInteger(record.size)||record.size<=0||record.size>(record.id===row.id?16384:65536)||record.encoded_size!==4*Math.ceil(record.size/3))||metadata.reduce((sum,record)=>sum+record.size,0)>524288)return pending('electorate-source-bound',[row.id]);
  const raw=[];
  for(const group of chunks(keys,50)){const [records]=await read([sql('SELECT id,size,body_base64 FROM app_collection_records WHERE id IN (SELECT value FROM json_each(?))',canonicalJson(group))]);raw.push(...records);}
  const records=new Map();let seal,manifest,pages;
  try{
   for(const record of raw){const meta=metadata.find(value=>value.id===record.id);if(!meta||record.size!==meta.size||record.body_base64.length!==meta.encoded_size||records.has(record.id))throw new TypeError('Changed electorate record.');records.set(record.id,{id:record.id,size:record.size,bytes:Uint8Array.from(atob(record.body_base64),c=>c.charCodeAt(0))});}
   manifest=records.get(row.id);pages=pageIds.map(id=>records.get(id));seal=await prepareCollectionList({manifest,pages},crypto);
  }catch(error){if(error instanceof TypeError||error instanceof SyntaxError||error?.name==='InvalidCharacterError')return pending('electorate-source-invalid',[row.id]);throw error;}
  const expected={id:row.id,count:row.member_count,pageIds,walletsDigest:row.wallets_digest,closureDigest:row.closure_digest,firstWallet:row.first_wallet,lastWallet:row.last_wallet};
  if(canonicalJson(seal)!==canonicalJson(expected))return pending('electorate-seal-conflict',[row.id]);
  const [indexes]=await read([sql('SELECT record_id,entry_count,entries_json FROM app_collection_eligibility_pages WHERE record_id IN (SELECT value FROM json_each(?))',canonicalJson(pageIds))]);
  if(indexes.length!==pageIds.length)return pending('electorate-index-missing',pageIds.filter(id=>!indexes.some(index=>index.record_id===id)));
  const wallets=[];
  for(const page of pages){const body=JSON.parse(new TextDecoder().decode(page.bytes)),index=indexes.find(value=>value.record_id===page.id);if(!index||index.entry_count!==body.entries.length||index.entries_json!==canonicalJson(body.entries))return pending('electorate-index-conflict',[page.id]);wallets.push(...body.entries);}
  selected.set(row.id,{seal,wallets});
 }
 return {kind:'ready',lists:selected};
}
