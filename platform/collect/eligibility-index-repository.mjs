import {prepareConfigAudit,configAuditStatement} from '../storage/atomic-audit.mjs';
import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions,matchesExpectedRevisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {prepareCollectionRecord} from './source-intake.mjs';
import {prepareEligibilityIndexCommand} from './eligibility-index-service.mjs';
const pending=(reason,id)=>({kind:'pending',reason,dependencyIds:[id]}),conflict=code=>({kind:'conflict',code});
const authority="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='collection-import' AND enabled=1)";
export function createEligibilityIndexRepository(driver,ports){
 const receipts=createAtomicReceipts(driver,ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 async function materializePage(value,previewOnly=false){
  const c=structuredClone(value),expected=await prepareEligibilityIndexCommand(c,ports.crypto);
  if(canonicalJson(c)!==canonicalJson(expected))throw new TypeError('Invalid eligibility index command.');
  const prior=await receipts.replay(c);if(prior)return prior;
  const now=ports.clock.nowMs();if(!Number.isSafeInteger(now)||now<0||now>8640000000000000-30000)return pending('source-clock-unavailable',c.input.id);
  const [versionRows,grants,records,indexes,heads]=await receipts.read([
   sql('SELECT * FROM app_revisions ORDER BY name'),sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='collection-import'",c.principal.id),
   sql(`SELECT id,format,kind,page_index,size,CASE WHEN size<=65536 AND length(body_base64)<=87384 THEN body_base64 ELSE NULL END AS body_base64 FROM app_collection_records WHERE id=?`,c.input.id),
   sql('SELECT record_id,entry_count,CASE WHEN length(entries_json)<=8192 THEN entries_json ELSE NULL END AS entries_json FROM app_collection_eligibility_pages WHERE record_id=?',c.input.id),
   sql('SELECT seq,event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1'),
  ]);
  const version=revisions(versionRows);if(!matchesExpectedRevisions(c.expectedRevisions,version))return conflict('revision_conflict');
  if(!grants[0]?.enabled)return conflict('operator_scope_required');
  const record=records[0];if(!record)return pending('eligibility-record-missing',c.input.id);
  if(record.id!==c.input.id||record.format!=='collection-page-v1'||record.kind!=='eligibility'||typeof record.body_base64!=='string')return pending('eligibility-record-invalid',c.input.id);
  let verified,body;
  try{
   const bytes=Uint8Array.from(atob(record.body_base64),char=>char.charCodeAt(0));
   verified=await prepareCollectionRecord({id:record.id,size:record.size,bytes},ports.crypto);
   body=JSON.parse(new TextDecoder().decode(bytes));
  }catch(error){if(error instanceof TypeError||error instanceof SyntaxError||error?.name==='InvalidCharacterError')return pending('eligibility-record-invalid',c.input.id);throw error;}
  if(verified.format!=='collection-page-v1'||verified.kind!=='eligibility'||verified.pageIndex!==record.page_index||verified.bodyBase64!==record.body_base64)return pending('eligibility-record-invalid',c.input.id);
  const entriesJson=canonicalJson(body.entries);if(body.entries.length>100||utf8(entriesJson).length>8192)return pending('eligibility-index-bound',c.input.id);
  if(indexes.length){const old=indexes[0];return old.record_id===c.input.id&&old.entry_count===body.entries.length&&old.entries_json===entriesJson?conflict('index_already_materialized'):pending('index-content-conflict',c.input.id);}
  const result={id:c.input.id,entryCount:body.entries.length,visibility:'private-staging'};
  if(previewOnly)return {kind:'preview',value:result,expectedRevisions:version};
  const event={category:'collection-source',entity:c.businessIdentity,changeKey:canonicalJson([c.operationKind,c.requestKey]),atMs:now,actor:c.principal.id,evidenceRef:c.input.id,payload:{operationKind:c.operationKind,requestDigest:c.requestDigest,resultRef:c.input.id,resultDigest:await ports.crypto.sha256(utf8(canonicalJson(result)))}};
  const audit=await prepareConfigAudit(heads[0],event,ports.crypto);
  return receipts.execute({...c,nowMs:now},{businessKey:c.input.id,input:{id:c.input.id,entries:body.entries,audit},result,resultRef:c.input.id,version,
   authoritySql:`${authority} AND ${nowSql}>=? AND ${nowSql}<=? AND EXISTS(SELECT 1 FROM app_collection_records WHERE id=? AND format='collection-page-v1' AND kind='eligibility' AND page_index=? AND size=? AND body_base64=?) AND NOT EXISTS(SELECT 1 FROM app_collection_eligibility_pages WHERE record_id=?)`,
   authorityValues:[c.principal.id,now,now+30000,record.id,record.page_index,record.size,record.body_base64,c.input.id],
   child:(gate,v)=>[sql(`INSERT INTO app_collection_eligibility_pages(record_id,entries_json,entry_count,operation_id) SELECT ?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,c.input.id,entriesJson,body.entries.length,...v,...v),configAuditStatement(audit,event,gate,v)],
  });
 }
 return Object.freeze({materializePage:value=>materializePage(value),previewPage:value=>materializePage(value,true)});
}
