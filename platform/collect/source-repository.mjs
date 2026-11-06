import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions,matchesExpectedRevisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {prepareCollectionRecord,prepareCollectionList,prepareCollectionSource,collectionIntakeCommandBytes} from './source-intake.mjs';
const requireValue=(condition,message)=>{if(!condition)throw new TypeError(message);};
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const conflict=code=>({kind:'conflict',code});
const authority="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='collection-import' AND enabled=1)";
const kinds={record:'collection.stage-record.v1',list:'collection.seal-list.v1',source:'collection.seal-source.v1'};
const tables={record:'app_collection_records',list:'app_collection_list_seals',source:'app_collection_source_seals'};
export function createCollectionSourceRepository(driver,ports){
 const {read,replay,execute}=createAtomicReceipts(driver,ports);
 async function validate(value,kind){
  const c=structuredClone(value);
  requireValue(c.principal?.kind==='operator'&&text(c.principal.id)&&c.operationKind===kind&&text(c.requestKey)&&Number.isSafeInteger(c.nowMs)&&c.nowMs>=0,'Invalid collection intake command.');
  requireValue(c.input&&Object.keys(c.input).length===1&&digest(c.input.id)&&c.businessIdentity===c.input.id,'Invalid collection source identity.');
  requireValue(c.requestDigest===await ports.crypto.sha256(collectionIntakeCommandBytes(c)),'Collection intake command digest mismatch.');
  return c;
 }
 async function capture(c,type){
  const prior=await replay(c);if(prior)return {outcome:prior};
  const [rs,grants,exists]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='collection-import'",c.principal.id),sql('SELECT id FROM '+tables[type]+' WHERE id=?',c.input.id)]);
  const version=revisions(rs);
  if(!matchesExpectedRevisions(c.expectedRevisions,version))return {outcome:conflict('revision_conflict')};
  if(!grants[0]?.enabled)return {outcome:conflict('operator_scope_required')};
  if(exists.length)return {outcome:conflict('source_already_staged')};
  return {version};
 }
 const api={
  async readRecords(ids){
   const keys=[...ids];requireValue(keys.length<=101&&keys.every(digest)&&new Set(keys).size===keys.length,'Invalid source record selection.');
   if(!keys.length)return [];
   const [rows]=await read([sql('SELECT id,size,body_base64 FROM app_collection_records WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',canonicalJson(keys))]);
   requireValue(rows.reduce((sum,row)=>sum+row.size,0)<=2*1024*1024,'Collection source read exceeds byte bound.');
   return rows.map(row=>({id:row.id,size:row.size,bytes:Uint8Array.from(atob(row.body_base64),c=>c.charCodeAt(0))}));
  },
  async readListSeals(ids){
   const keys=[...ids];requireValue(keys.length<=32&&keys.every(digest)&&new Set(keys).size===keys.length,'Invalid sealed list selection.');
   if(!keys.length)return [];
   const [rows]=await read([sql('SELECT * FROM app_collection_list_seals WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',canonicalJson(keys))]);
   requireValue(utf8(JSON.stringify(rows)).length<=256*1024,'Collection list metadata exceeds byte bound.');
   return rows.map(row=>({id:row.id,count:row.member_count,pageIds:JSON.parse(row.page_ids_json),walletsDigest:row.wallets_digest,closureDigest:row.closure_digest,firstWallet:row.first_wallet,lastWallet:row.last_wallet}));
  },
  async stageRecord(command,record){
   const input=structuredClone(record),c=await validate(command,kinds.record),captured=await capture(c,'record');if(captured.outcome)return captured.outcome;
   const verified=await prepareCollectionRecord(input,ports.crypto);
   requireValue(verified.id===c.input.id,'Collection record command identity mismatch.');
   return execute(c,{businessKey:c.input.id,input:c.input,result:{id:verified.id,size:verified.size,format:verified.format,visibility:'private-staging'},resultRef:c.input.id,version:captured.version,
    authoritySql:authority,authorityValues:[c.principal.id],child:(gate,v)=>[
     sql(`INSERT INTO app_collection_records SELECT ?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,verified.id,verified.format,verified.kind,verified.pageIndex,verified.size,verified.bodyBase64,...v,...v),
    ]});
  },
  async sealList(command,proposed){
   const candidate=structuredClone(proposed),c=await validate(command,kinds.list),captured=await capture(c,'list');if(captured.outcome)return captured.outcome;
   const records=await api.readRecords([c.input.id]);requireValue(records.length===1,'Missing collection list manifest.');
   const body=JSON.parse(new TextDecoder().decode(records[0].bytes));
   requireValue(body.format==='collection-list-v1'&&Array.isArray(body.pageIds),'Invalid collection list manifest.');
   const seal=await prepareCollectionList({manifest:records[0],pages:await api.readRecords(body.pageIds)},ports.crypto);
   requireValue(canonicalJson(candidate)===canonicalJson(seal),'Forged collection list seal.');
   return execute(c,{businessKey:c.input.id,input:c.input,result:seal,resultRef:c.input.id,version:captured.version,
    authoritySql:authority,authorityValues:[c.principal.id],child:(gate,v)=>[
     sql(`INSERT INTO app_collection_list_seals SELECT ?,?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,seal.id,seal.count,canonicalJson(seal.pageIds),seal.walletsDigest,seal.closureDigest,seal.firstWallet,seal.lastWallet,...v,...v),
    ]});
  },
  async sealSource(command,proposed){
   const candidate=structuredClone(proposed),c=await validate(command,kinds.source),captured=await capture(c,'source');if(captured.outcome)return captured.outcome;
   const records=await api.readRecords([c.input.id]);requireValue(records.length===1,'Missing collection source root.');
   const body=JSON.parse(new TextDecoder().decode(records[0].bytes));
   requireValue(body.format==='collection-source-v1'&&Array.isArray(body.stages)&&Array.isArray(body.admissions?.pageIds),'Invalid collection source root.');
   const listIds=[...new Set(body.stages.filter(stage=>stage.eligibility?.kind==='list').map(stage=>stage.eligibility.manifestId))];
   const seal=await prepareCollectionSource({root:records[0],lists:await api.readListSeals(listIds),admissionPages:await api.readRecords(body.admissions.pageIds)},ports.crypto);
   requireValue(canonicalJson(candidate)===canonicalJson(seal),'Forged collection source seal.');
   return execute(c,{businessKey:c.input.id,input:c.input,result:seal,resultRef:c.input.id,version:captured.version,
    authoritySql:authority,authorityValues:[c.principal.id],child:(gate,v)=>[
     sql(`INSERT INTO app_collection_source_seals SELECT ?,?,?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,seal.id,seal.inventoryId,seal.sourceRevision,seal.declaredStateDigest,seal.stageCount,seal.admissionCount,seal.closureDigest,canonicalJson(seal),...v,...v),
    ]});
  },
 };
 return Object.freeze(api);
}
