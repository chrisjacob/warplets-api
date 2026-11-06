import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {buildCollectionFulfillmentCommand} from './fulfillment-service.mjs';
import {verifyCollectionMintFulfillmentEvidence,MAX_COLLECTION_MINT_BYTES} from './mint-fulfillment-evidence.mjs';
import {prepareNormalizedMintDraw,prepareNormalizedMintFulfillment} from './mint-plan.mjs';
const clone=v=>JSON.parse(canonicalJson(v));
const pending=reason=>({kind:'pending',reason,dependencyIds:[]}),conflict=code=>({kind:'conflict',code});
const bound=(c,n,alias=c.split('.').at(-1))=>`CASE WHEN length(CAST(${c} AS BLOB))<=${n} THEN ${c} ELSE NULL END ${alias}`;
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
const grant="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='collection-evidence' AND enabled=1)";
/** Private normalized mint fulfillment. Evidence and deterministic outcome are
 * reverified from immutable045 admission; no client result can authorize effects. */
export function createMintFulfillmentRepository(driver,ports){
 const {crypto,clock,artifacts,beaconVerifier}=ports,{read,replay,execute}=createAtomicReceipts(driver,ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 async function fulfill(value){
  const c=clone(value);if(c.operationKind!=='collection.fulfill-operation.v1'||canonicalJson(c)!==canonicalJson(await buildCollectionFulfillmentCommand(c.principal,{requestKey:c.requestKey,...c.input},crypto)))throw new TypeError('Mint fulfillment command identity mismatch.');
  const prior=await replay(c);if(prior)return prior;const i=c.input,nowMs=clock.nowMs();if(!time(nowMs)||nowMs>8640000000000000-30000)return pending('mint-fulfillment-clock-unavailable');
  const captured=await read([
   sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),
   sql('SELECT revision FROM app_recovery_watermark WHERE id=1'),
   sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='collection-evidence'",c.principal.id),
   sql('SELECT operation_id FROM app_collection_mint_fulfillments WHERE operation_id=?',i.operationId),
   sql(`SELECT r.receipt_digest,${bound('r.stream_key',4096)},${bound('r.source_revision',1024)},${bound('r.source_id',1024)},${bound('r.object_key',512)},${bound('r.envelope_json',16384)},${bound('r.decision_json',16384)},${bound('r.status',32)},${bound('s.config_json',65536)},${bound('s.config_digest',64)},${bound('h.receipt_digest',64,'head_digest')},${bound('a.byte_digest',64)},a.size,${bound('a.content_type',128)},a.semantic_digest IS NULL artifact_is_raw,${bound('rc.state',32,'receipt_state')} FROM app_evidence_receipts r JOIN app_evidence_sources s ON s.source_id=r.source_id AND s.source_revision=r.source_revision JOIN app_command_receipts rc ON rc.operation_id=r.operation_id LEFT JOIN app_evidence_heads h ON h.stream_key=r.stream_key LEFT JOIN app_private_artifacts a ON a.object_key=r.object_key WHERE r.receipt_digest=?`,i.evidenceReceiptId),
   sql(`SELECT id,${bound('kind',16)},${bound('inventory_id',128)},${bound('owner',64)},${bound('commitment',128)},created_ms,settled_ms,${bound('operation',16384)},${bound('proof_id',128)},${bound('evidence_digest',64)},${bound('receipt',16384)},receipt IS NULL receipt_absent,proof_id IS NULL proof_absent,evidence_digest IS NULL evidence_absent FROM collect_operations WHERE id=?`,i.operationId),
   sql(`SELECT r.operation_id,r.inventory_id,r.stage_id,r.ordinal,r.wallet,r.commitment,r.admitted_ms,r.terms_digest,r.price_lamports,r.cost_lamports,r.membership_source_id,r.fair_policy_hash,r.fair_registered_ms,r.target_round,r.context_digest,${bound('r.effect_json',16384)},${bound('r.result_json',16384)},${bound('rc.state',32,'receipt_state')},${bound('rc.result_json',16384,'receipt_result')},${bound('rc.output_digest',64,'receipt_output_digest')},${bound('rc.principal_key',128,'receipt_principal')},${bound('rc.operation_kind',64,'receipt_kind')},${bound('rc.result_ref',128,'receipt_ref')},s.stage_type,${bound('s.terms_json',8192,'stage_json')}
    FROM app_collection_mint_admissions r JOIN app_command_receipts rc ON rc.operation_id=r.command_operation_id JOIN app_collection_stages s ON s.inventory_id=r.inventory_id AND s.stage_id=r.stage_id WHERE r.operation_id=?`,i.operationId),
   sql(`SELECT h.id,h.kind,h.tranche,h.season_start,h.origin_digest,a.revision,a.admitted,a.fulfilled,${bound('a.remaining_json',512)} FROM collect_inventories h JOIN app_collection_authorities a ON a.inventory_id=h.id JOIN collect_operations op ON op.inventory_id=h.id WHERE op.id=?`,i.operationId),
   sql(`SELECT ${bound('policy_hash',64)},registered_ms,${bound('traits',524288)} FROM fair_inventories WHERE inventory_id=(SELECT inventory_id FROM collect_operations WHERE id=?)`,i.operationId),
   sql(`SELECT target_round,${bound('context_digest',64)} FROM fair_requests WHERE operation_id=?`,i.operationId),
   sql(`SELECT operation_id,${bound('proof_id',128)},${bound('signed_round',16384)},${bound('fixture',16384)},settled_ms FROM fair_results WHERE operation_id=?`,i.operationId),
   sql('SELECT MAX(v.activated_ms) latest FROM local_campaign_registry r JOIN vault_manifests v ON v.id=r.market_id'),
  ]);
  if(utf8(canonicalJson(captured)).length>1048576)return pending('mint-fulfillment-read-bound');
  const [rs,watermarks,grants,existing,evidences,operations,admissions,headers,policies,requests,fairResults,snapshots]=clone(captured),op=operations[0],r=admissions[0],h=headers[0],e=evidences[0],policy=policies[0]??null,request=requests[0]??null,oldFair=fairResults[0]??null,wm=watermarks[0]?.revision;
  if(grants[0]?.enabled!==1)return conflict('operator_scope_required');if(existing.length)return conflict('operation_already_fulfilled');
  if(rs.length!==3||new Set(rs.map(r=>r.name)).size!==3||rs.some(r=>!['earn','source','control'].includes(r.name)||typeof r.revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(r.revision)||!Number.isSafeInteger(Number(r.revision)))||watermarks.length!==1||!Number.isSafeInteger(wm)||wm<0)return pending('mint-fulfillment-revisions-unavailable');const version=revisions(rs);
  if(!op||!r||!h||op.kind!=='mint')return pending('guarded-mint-admission-missing');
  if(op.settled_ms!==null||op.receipt_absent!==1||op.proof_absent!==1||op.evidence_absent!==1)return pending('operation-already-settled');
  if(!e)return pending('mint-fulfillment-evidence-missing');if(e.head_digest!==i.evidenceReceiptId)return pending('mint-fulfillment-head-changed');
  if(e.status!=='verified'||e.receipt_state!=='committed'||e.byte_digest!==i.evidenceDigest||!Number.isSafeInteger(e.size)||e.size<1||e.size>MAX_COLLECTION_MINT_BYTES||e.content_type!=='application/json'||e.artifact_is_raw!==1)return pending('mint-fulfillment-evidence-unavailable');
  if(['config_json','envelope_json','decision_json','source_id','source_revision','object_key','stream_key','config_digest'].some(k=>e[k]===null)||['operation','owner','inventory_id','commitment'].some(k=>op[k]===null)||['effect_json','result_json','receipt_result','receipt_output_digest','stage_json'].some(k=>r[k]===null)||h.remaining_json===null)return pending('mint-fulfillment-read-byte-bound');
  const founder=r.stage_type==='founder';if(r.receipt_state!=='committed'||r.receipt_kind!=='collection.reserve-operation.v1'||(founder?!r.receipt_principal?.startsWith('operator:'):r.receipt_principal!=='wallet:'+op.owner)||r.receipt_ref!==op.id||r.receipt_result!==r.result_json||r.inventory_id!==h.id||r.inventory_id!==op.inventory_id||r.wallet!==op.owner||r.commitment!==op.commitment||r.admitted_ms!==op.created_ms)return pending('mint-admission-receipt-conflict');
  let artifact;try{artifact=await artifacts.getVerified({key:e.object_key,byteDigest:e.byte_digest,size:e.size,semanticDigest:null,visibility:'private',contentType:'application/json'});}catch{return pending('mint-fulfillment-artifact-unavailable');}if(artifact.status!=='verified')return pending('mint-fulfillment-artifact-'+artifact.status);
  let verified,plan,draw,authority,admission;
  try{
   const original=JSON.parse(r.result_json),priorEffect=JSON.parse(r.effect_json),stage=JSON.parse(r.stage_json);
   if(await crypto.sha256(utf8(canonicalJson(original)))!==r.receipt_output_digest||original.operationId!==op.id||original.kind!=='mint'||original.inventoryId!==h.id||original.wallet!==op.owner||original.stageId!==r.stage_id||original.termsDigest!==r.terms_digest||original.priceLamports!==r.price_lamports||original.costLamports!==r.cost_lamports||original.createdMs!==r.admitted_ms||original.status!=='awaiting-evidence'||original.executable!==false||original.source!=='local-fixture'||original.fairness!==(r.fair_policy_hash===null?'manual-fixture':'configured-offline-beacon')||stage.id!==r.stage_id||stage.termsDigest!==r.terms_digest||stage.priceLamports?.$lamports!==r.price_lamports||stage.costLamports?.$lamports!==r.cost_lamports||priorEffect.operationJson!==op.operation||priorEffect.authorityBefore.admitted!==r.ordinal||priorEffect.authorityAfter.admitted!==r.ordinal+1||op.operation!==JSON.stringify({stageId:r.stage_id,costLamports:{$lamports:r.cost_lamports},priceLamports:{$lamports:r.price_lamports}}))return pending('mint-admission-receipt-conflict');
   if(h.origin_digest!==await crypto.sha256(utf8(JSON.stringify([h.id,h.kind,h.tranche,h.season_start]))))return pending('mint-fulfillment-origin-conflict');
   verified=await verifyCollectionMintFulfillmentEvidence({source:JSON.parse(e.config_json),envelope:JSON.parse(e.envelope_json),decision:JSON.parse(e.decision_json),receiptDigest:i.evidenceReceiptId,bytes:artifact.bytes},crypto);
   if(verified.byteDigest!==i.evidenceDigest||verified.source.sourceId!==e.source_id||verified.source.sourceRevision!==e.source_revision||verified.sourceConfigDigest!==e.config_digest||verified.streamKey!==e.stream_key||verified.envelope.objectRef!==e.object_key||verified.envelope.ingestedAtMs>nowMs)return pending('mint-fulfillment-evidence-binding');
   authority={inventoryId:h.id,kind:h.kind,tranche:h.tranche,seasonStart:h.season_start,revision:h.revision,admitted:h.admitted,fulfilled:h.fulfilled,remaining:JSON.parse(h.remaining_json)};
   if(canonicalJson(authority.remaining)!==h.remaining_json)return pending('mint-fulfillment-remaining-json');
   admission={operationId:op.id,ordinal:r.ordinal,wallet:r.wallet,stageId:r.stage_id,drawCommitment:r.commitment,admittedAt:r.admitted_ms,costLamports:r.cost_lamports,priceLamports:r.price_lamports,termsDigest:r.terms_digest,membershipSourceId:r.membership_source_id,fairPolicyHash:r.fair_policy_hash,fairRegisteredMs:r.fair_registered_ms,targetRound:r.target_round,contextDigest:r.context_digest};
   const {kind:ignored,...event}=verified.event,facts={authority,admission,event,fairness:policy&&request?{policy,request}:null,nowMs};
   if((policy===null)!==(request===null))return pending('mint-fairness-binding-invalid');
   draw=await prepareNormalizedMintDraw(facts,crypto,beaconVerifier);
   const [reservedRows]=await read([sql(`SELECT inventory_id,slot_index,${bound('asset_id',44)} FROM fair_reserved_assets WHERE inventory_id=? AND slot_index=?`,h.id,draw.slotIndex)]),reserved=reservedRows[0]??null;
   const assetId=admission.fairPolicyHash===null?draw.assetId:reserved?.asset_id;if(!assetId)return pending('mint-reserved-asset-missing');
   const slot=h.kind==='genesis'?{kind:'genesis',tranche:h.tranche,level:draw.level,ordinal:draw.ordinal}:{kind:'season',seasonId:h.id,slotIndex:draw.slotIndex},slotJson=JSON.stringify(slot);
   const [occupied]=await read([sql(`SELECT
    (SELECT COUNT(*) FROM collect_assets WHERE id=?)+(SELECT COUNT(*) FROM vault_assets WHERE id=?)+(SELECT COUNT(*) FROM fair_reserved_assets WHERE asset_id=? AND (?=1 OR inventory_id<>?)) asset_count,
    (SELECT COUNT(*) FROM vault_assets WHERE slot_key=?) slot_count,
    (SELECT COUNT(*) FROM collect_operations WHERE proof_id=?) proof_count`,assetId,assetId,assetId,admission.fairPolicyHash===null?1:0,h.id,slotJson,draw.proofId)]);
   const counts=occupied[0];plan=await prepareNormalizedMintFulfillment({...facts,reservedAsset:admission.fairPolicyHash===null?null:{inventoryId:reserved.inventory_id,slotIndex:reserved.slot_index,assetId:reserved.asset_id},conflicts:{assetCount:counts.asset_count,slotCount:counts.slot_count,proofCount:counts.proof_count,snapshotCount:snapshots[0]?.latest!==null&&snapshots[0]?.latest>=event.atMs?1:0}},crypto,beaconVerifier);
   if(oldFair){const fair=plan.effect.fairResult;if(!fair||oldFair.operation_id!==op.id||oldFair.proof_id!==fair.proofId||oldFair.signed_round!==fair.signedRoundJson||oldFair.fixture!==fair.fixtureJson||!time(oldFair.settled_ms)||oldFair.settled_ms<event.atMs||oldFair.settled_ms>nowMs)return pending('mint-existing-fair-result-conflict');}
  }catch(error){return pending(typeof error.code==='string'?error.code:'mint-fulfillment-evidence-invalid');}
  const result={...plan.result,evidenceReceiptId:i.evidenceReceiptId},effect={...plan.effect,authorityBefore:{revision:h.revision,admitted:h.admitted,fulfilled:h.fulfilled,remainingJson:h.remaining_json},fairResult:plan.effect.fairResult?{...plan.effect.fairResult,settledMs:oldFair?.settled_ms??plan.effect.fairResult.settledMs}:null},fair=effect.fairResult,asset=effect.asset,vault=JSON.parse(effect.vaultEventJson),proofId=plan.fixture.proofId,remainingJson=canonicalJson(effect.remaining);
  if(utf8(canonicalJson(effect)).length>32768)return pending('mint-fulfillment-effect-bound');
  const conditions=[grant,`${nowSql}>=? AND ${nowSql}<=?`,'(SELECT revision FROM app_recovery_watermark WHERE id=1)=?',
   'EXISTS(SELECT 1 FROM app_evidence_heads WHERE stream_key=? AND receipt_digest=?)','EXISTS(SELECT 1 FROM app_evidence_sources WHERE source_id=? AND source_revision=? AND config_digest=?)',
   'EXISTS(SELECT 1 FROM app_private_artifacts WHERE object_key=? AND byte_digest=? AND size=? AND semantic_digest IS NULL)',
   'EXISTS(SELECT 1 FROM app_collection_authorities WHERE inventory_id=? AND revision=? AND admitted=? AND fulfilled=? AND remaining_json=?)',
   'EXISTS(SELECT 1 FROM collect_operations WHERE id=? AND operation=? AND owner=? AND settled_ms IS NULL AND receipt IS NULL AND proof_id IS NULL AND evidence_digest IS NULL)',
   'NOT EXISTS(SELECT 1 FROM app_collection_mint_fulfillments WHERE operation_id=?)','NOT EXISTS(SELECT 1 FROM collect_operations WHERE proof_id=?)',
   'NOT EXISTS(SELECT 1 FROM collect_assets WHERE id=?)','NOT EXISTS(SELECT 1 FROM vault_assets WHERE id=? OR slot_key=?)',
   'NOT EXISTS(SELECT 1 FROM local_campaign_registry r JOIN vault_manifests v ON v.id=r.market_id WHERE v.activated_ms>=?)',
   ...(fair?['EXISTS(SELECT 1 FROM fair_reserved_assets WHERE inventory_id=? AND slot_index=? AND asset_id=?)']:['NOT EXISTS(SELECT 1 FROM fair_reserved_assets WHERE asset_id=?)']),
   oldFair?'EXISTS(SELECT 1 FROM fair_results WHERE operation_id=? AND proof_id=? AND signed_round=? AND fixture=? AND settled_ms=?)':'NOT EXISTS(SELECT 1 FROM fair_results WHERE operation_id=? OR proof_id=?)'];
  const values=[c.principal.id,nowMs,nowMs+30000,wm,e.stream_key,i.evidenceReceiptId,e.source_id,e.source_revision,e.config_digest,e.object_key,e.byte_digest,e.size,h.id,h.revision,h.admitted,h.fulfilled,h.remaining_json,op.id,op.operation,op.owner,op.id,proofId,asset.id,asset.id,asset.slotJson,result.at,...(fair?[h.id,draw.slotIndex,asset.id]:[asset.id]),...(oldFair?[op.id,oldFair.proof_id,oldFair.signed_round,oldFair.fixture,oldFair.settled_ms]:[op.id,proofId])];
  const outcome=await execute({...c,nowMs,expectedRevisions:version},{businessKey:c.businessIdentity,input:i,result,resultRef:op.id,version,authoritySql:conditions.join(' AND '),authorityValues:values,child:(gate,p)=>[
   sql(`INSERT INTO collect_assets(id,inventory_id,owner,bind_ms,observed_ms,reveal_ms,slot,asset) SELECT ?,?,?,?,?,NULL,?,? WHERE ${gate}`,asset.id,h.id,asset.owner,result.at,result.at,asset.slotJson,asset.assetJson,...p),
   sql(`INSERT INTO vault_assets(id,slot_key,coords,owner,latest_ms) SELECT ?,?,?,?,? WHERE ${gate}`,asset.id,asset.slotJson,asset.slotJson,asset.owner,result.at,...p),
   sql(`INSERT INTO vault_observations(event_id,asset_id,kind,observed_ms,body) SELECT ?,?,'bind',?,? WHERE ${gate}`,vault.eventId,asset.id,result.at,effect.vaultEventJson,...p),
   ...effect.history.map(row=>sql(`INSERT INTO collect_level_history(asset_id,effective_ms,level,source_ref) SELECT ?,?,?,? WHERE ${gate}`,row.assetId,row.effectiveMs,row.level,row.sourceRef,...p)),
   ...(fair&&!oldFair?[sql(`INSERT INTO fair_results(operation_id,proof_id,signed_round,fixture,settled_ms) SELECT ?,?,?,?,? WHERE ${gate}`,op.id,fair.proofId,fair.signedRoundJson,fair.fixtureJson,fair.settledMs,...p)]:[]),
   sql(`UPDATE app_collection_authorities SET revision=?,fulfilled=?,remaining_json=? WHERE inventory_id=? AND revision=? AND admitted=? AND fulfilled=? AND remaining_json=? AND ${gate}`,effect.authorityRevision,effect.fulfilled,remainingJson,h.id,h.revision,h.admitted,h.fulfilled,h.remaining_json,...p),
   sql(`INSERT INTO app_collection_mint_fulfillments(operation_id,evidence_receipt_digest,byte_digest,stream_key,source_revision,asset_id,proof_id,effective_ms,provenance,command_operation_id,result_json,effect_json) SELECT ?,?,?,?,?,?,?,?,?,operation_id,?,? FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,op.id,i.evidenceReceiptId,i.evidenceDigest,e.stream_key,e.source_revision,asset.id,proofId,result.at,result.provenance,canonicalJson(result),canonicalJson(effect),...p,...p),
   sql(`UPDATE collect_operations SET settled_ms=?,proof_id=?,evidence_digest=?,receipt=? WHERE id=? AND settled_ms IS NULL AND ${gate}`,result.at,proofId,effect.legacyEvidenceDigest,effect.operationReceiptJson,op.id,...p),
  ]});
  if(outcome.kind==='conflict'&&(clock.nowMs()<nowMs||clock.nowMs()>nowMs+30000))return pending('mint-fulfillment-preparation-window-expired');return outcome;
 }
 return Object.freeze({async fulfillMint(value){
  // A competing accepted commit can appear after the initial replay read and
  // before a later evidence/occupancy check. Resolve it before returning a hold.
  const command=clone(value),result=await fulfill(command);
  return ['pending','conflict'].includes(result.kind)?await replay(command)??result:result;
 }});
}
