import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createInventory} from '../domain/collections/inventory.mjs';
import {LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
import {readGovernanceElectorates} from '../governance/operator-source.mjs';
import {buildStagePublicationCommand,PUBLISH_COLLECTION_STAGE} from './stage-service.mjs';
import {prepareStagePublication} from './stage-plan.mjs';
const clone=v=>JSON.parse(canonicalJson(v));
const pending=reason=>({kind:'pending',reason,dependencyIds:[]}),conflict=code=>({kind:'conflict',code});
const grant="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='collection-publication' AND enabled=1)";
const founderGrant="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='collection-founder' AND enabled=1)";
/** Private normalized stage authority. An initial empty reference header can be
 * adopted exactly; populated legacy state requires a separately verified import.
 * Neither a source seal nor a caller approval boolean substitutes for scope. */
export function createStagePublicationRepository(driver,ports){
 const {crypto,clock}=ports,{read,replay,execute}=createAtomicReceipts(driver,ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 return Object.freeze({async publishStage(value){
  const c=clone(value);if(c.operationKind!==PUBLISH_COLLECTION_STAGE||canonicalJson(c)!==canonicalJson(await buildStagePublicationCommand(c.principal,{requestKey:c.requestKey,input:c.input},crypto)))throw new TypeError('Invalid stage publication command.');
  const prior=await replay(c);if(prior)return prior;const i=c.input,nowMs=clock.nowMs(),needsFounder=i.type==='public'||i.type==='founder'||i.inventoryOverrideReason!==null;
  if(!Number.isSafeInteger(nowMs)||nowMs<0||nowMs>8640000000000000)return pending('stage-clock-unavailable');
  const captured=await read([
   sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),
   sql("SELECT scope,enabled FROM app_operator_scopes WHERE operator=? AND scope IN ('collection-publication','collection-founder')",c.principal.id),
   sql(`SELECT id,kind,tranche,season_start,season_month,revision,origin_digest,
    CASE WHEN length(CAST(state AS BLOB))<=4096 THEN state ELSE NULL END initial_state,
    EXISTS(SELECT 1 FROM collect_assets WHERE inventory_id=collect_inventories.id) has_assets,
    EXISTS(SELECT 1 FROM collect_operations WHERE inventory_id=collect_inventories.id) has_operations
    FROM collect_inventories WHERE id=?`,i.inventoryId),
   sql('SELECT * FROM app_collection_authorities WHERE inventory_id=?',i.inventoryId),
   sql('SELECT stage_id,ordinal,terms_digest,CASE WHEN length(CAST(terms_json AS BLOB))<=8192 THEN terms_json ELSE NULL END terms_json FROM app_collection_stages WHERE inventory_id=? ORDER BY ordinal LIMIT 33',i.inventoryId),
   sql(`SELECT p.id,p.tranche,
    CASE WHEN EXISTS(SELECT 1 FROM app_collection_authorities WHERE inventory_id=p.id)
     THEN (SELECT json_group_array(opens_ms) FROM (SELECT opens_ms FROM app_collection_stages WHERE inventory_id=p.id ORDER BY ordinal LIMIT 33))
     ELSE CASE WHEN length(CAST(p.state AS BLOB))<=33554432 AND json_valid(p.state) THEN (SELECT json_group_array(json_extract(value,'$.opensAt')) FROM (SELECT value FROM json_each(p.state,'$.stages') LIMIT 33)) ELSE NULL END END openings_json
    FROM collect_inventories p WHERE p.tranche=(SELECT tranche-1 FROM collect_inventories WHERE id=?)`,i.inventoryId),
   sql('SELECT id,tranche_open_ms FROM genesis_ballots WHERE id=?',i.ballotId),
  ]);
  if(utf8(canonicalJson(captured)).length>262144)return pending('stage-context-byte-bound');
  const [rs,grants,headers,authorities,stages,previous,ballots]=captured,h=headers[0],authority=authorities[0];
  if(!grants.some(g=>g.scope==='collection-publication'&&g.enabled===1)||needsFounder&&!grants.some(g=>g.scope==='collection-founder'&&g.enabled===1))return conflict('operator_scope_required');
  if(!h)return pending('stage-inventory-missing');if(stages.some(s=>s.stage_id===i.stageId))return conflict('stage_already_published');
  if(rs.length!==3||rs.some(r=>!['earn','source','control'].includes(r.name)||typeof r.revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(r.revision)))return pending('stage-revisions-unavailable');
  const version=revisions(rs);let initialStateDigest=null,stageFacts;
  try{
   if(!authority){
    const expected=JSON.stringify(createInventory({id:h.id,kind:h.kind,tranche:h.tranche??undefined}));
    if(h.revision!==0||h.initial_state!==expected||h.has_assets||h.has_operations||stages.length)return pending('stage-populated-reference-adoption-required');
    if(h.kind==='genesis'&&(h.season_start!==null||h.season_month!==null))return pending('stage-reference-header-conflict');
    if(h.origin_digest!==await crypto.sha256(utf8(JSON.stringify([h.id,h.kind,h.tranche,h.season_start]))))return pending('stage-reference-origin-conflict');
    if(h.kind==='season'&&h.season_month!==new Date(h.season_start).toISOString().slice(0,7))return pending('stage-reference-season-conflict');
    initialStateDigest=await crypto.sha256(utf8(expected));
   }else if(authority.origin_kind!=='empty-reference'||authority.initial_revision!==h.revision||!Number.isSafeInteger(authority.revision)||authority.revision<0||authority.revision>=Number.MAX_SAFE_INTEGER)return pending('stage-authority-unavailable');
   if(stages.length>=32||stages.some((s,n)=>s.ordinal!==n||s.terms_json===null))return pending('stage-context-invalid');
   stageFacts=stages.map(row=>{const terms=JSON.parse(row.terms_json);if(canonicalJson(terms)!==row.terms_json||terms.id!==row.stage_id||terms.termsDigest!==row.terms_digest)throw new TypeError('Stage binding mismatch.');return terms;});
  }catch{return pending('stage-reference-invalid');}
  let eligibility=null;
  if(i.eligibilityListId!==null){const lists=await readGovernanceElectorates(read,[i.eligibilityListId],crypto);if(lists.kind!=='ready')return lists;eligibility={id:i.eligibilityListId,wallets:lists.lists.get(i.eligibilityListId).wallets};}
  let plan;try{plan=await prepareStagePublication(i,{header:{id:h.id,kind:h.kind,tranche:h.tranche,seasonStart:h.season_start,revision:authority?.revision??0},stages:stageFacts,nowMs,eligibility,
   previous:previous[0]?{tranche:previous[0].tranche,openings:JSON.parse(previous[0].openings_json)}:null,ballot:ballots[0]?{id:ballots[0].id,trancheOpeningMs:ballots[0].tranche_open_ms}:null},crypto);}catch(error){return pending(typeof error.code==='string'?error.code:'stage-policy-invalid');}
  const result={inventoryId:h.id,stageId:i.stageId,termsDigest:plan.stage.termsDigest,publicationRevision:plan.expectedInventoryRevision+1,eligibility:plan.eligibility,source:'local-fixture',executable:false},stageJson=canonicalJson(plan.stage);
  const conditions=[grant,`${nowSql}>=?`,`${nowSql}>=?`,'EXISTS(SELECT 1 FROM collect_inventories WHERE id=? AND origin_digest=? AND revision=?)',
   '(SELECT COUNT(*) FROM app_collection_stages WHERE inventory_id=?)=?',
   authority?'EXISTS(SELECT 1 FROM app_collection_authorities WHERE inventory_id=? AND revision=?)':"NOT EXISTS(SELECT 1 FROM app_collection_authorities WHERE inventory_id=?) AND EXISTS(SELECT 1 FROM collect_inventories WHERE id=? AND state=?) AND NOT EXISTS(SELECT 1 FROM collect_assets WHERE inventory_id=?) AND NOT EXISTS(SELECT 1 FROM collect_operations WHERE inventory_id=?)",
   ...(needsFounder?[founderGrant]:[])];
  const values=[c.principal.id,nowMs,i.publishedAt,h.id,h.origin_digest,h.revision,h.id,stages.length,...(authority?[h.id,authority.revision]:[h.id,h.id,h.initial_state,h.id,h.id]),...(needsFounder?[c.principal.id]:[])];
  return execute({...c,nowMs,expectedRevisions:version},{businessKey:c.businessIdentity,input:i,result,resultRef:canonicalJson([h.id,i.stageId]),version,authoritySql:conditions.join(' AND '),authorityValues:values,child:(gate,p)=>[
   ...(!authority?[sql(`INSERT INTO app_collection_authorities(inventory_id,origin_kind,initial_state_digest,initial_revision,revision,admitted,fulfilled,remaining_json,activation_command_id) SELECT ?,'empty-reference',?,0,0,0,0,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,h.id,initialStateDigest,canonicalJson(LEVEL_QUOTAS),...p,...p)]:[]),
   sql(`UPDATE app_collection_authorities SET revision=revision+1 WHERE inventory_id=? AND revision=? AND ${gate}`,h.id,plan.expectedInventoryRevision,...p),
   sql(`INSERT INTO app_collection_stages(inventory_id,stage_id,ordinal,stage_type,published_ms,opens_ms,closes_ms,terms_digest,terms_json,eligibility_kind,list_id,eligible_count,command_operation_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,h.id,i.stageId,plan.ordinal,i.type,i.publishedAt,i.opensAt,i.closesAt,plan.stage.termsDigest,stageJson,plan.eligibility.kind,plan.eligibility.listId,plan.eligibility.count,...p,...p),
  ]});
 }});
}
