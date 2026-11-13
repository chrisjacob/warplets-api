import {packRecoveryV2Checkpoint} from './v2-checkpoint.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {actionRecoveryHistoryStatements,verifyActionRecoveryHistory} from '../transactions/recovery-reads.mjs';
import {buildRecordedHeightCommand,EXPIRE_RECORDED_ATTEMPT} from '../transactions/recorded-height-service.mjs';
import {verifyRecordedTransactionHeight} from '../transactions/recorded-height-evidence.mjs';
const need=(ok,reason)=>{if(!ok)throw new TypeError('Recovery recorded expiry '+reason);},size=v=>utf8(canonicalJson(v)).length,hash=(c,v)=>c.sha256(utf8(canonicalJson(v))),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const bounded=(column,max,alias)=>`CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END ${alias}`;
export const recordedExpiryCountsSql=()=>sql(`SELECT (SELECT COUNT(*) FROM app_recorded_attempt_expiries) expiries,(SELECT COUNT(DISTINCT intent_id) FROM app_recorded_attempt_expiries) intents,(SELECT COUNT(*) FROM app_command_receipts WHERE operation_kind='${EXPIRE_RECORDED_ATTEMPT}') receipts`);
const sidecarSql=(intentId,after)=>sql(`SELECT o.*,r.operation_kind,r.principal_key,r.request_key,r.request_digest,r.output_digest,r.result_ref,r.state receipt_state,r.created_ms,
 ${bounded('r.input_json',2048,'input_json')},${bounded('r.result_json',2048,'result_json')},${bounded('r.expected_revisions',1024,'expected_revisions')},r.business_key,
 a.state attempt_state,a.signature,(SELECT COUNT(*) FROM tx_receipts t WHERE t.attempt_id=a.id) observations
 FROM app_recorded_attempt_expiries o LEFT JOIN app_command_receipts r ON r.operation_id=o.operation_id LEFT JOIN tx_attempts a ON a.id=o.attempt_id
 WHERE o.intent_id=? AND o.prior_revision>? ORDER BY o.prior_revision,o.event_id LIMIT 2`,intentId,after);
export async function verifyRecordedExpiryHistory(input,crypto){
 const copied=structuredClone(input),verified=await verifyActionRecoveryHistory(copied,crypto),lineage=copied.attempts.filter(a=>a.state==='expired').map(a=>{
  need(a.signature===null&&!copied.receipts.some(r=>r.attempt_id===a.id),'expired unsigned history.');const packet=JSON.parse(a.packet);
  // Every preceding attempt is verified unsigned and expired: preparation and
  // expiry each advance revision once. Future attempts do not alter this cut.
  return {attemptId:a.id,index:a.attempt_index,messageHash:a.message_hash,lastValidBlockHeight:packet.lifetime.lastValidBlockHeight,contextSlot:packet.lifetime.contextSlot,observedAtMs:packet.lifetime.observedAt,priorRevision:2*a.attempt_index-1};
 });
 return {revision:verified.value.revision,history:{id:verified.value.id,owner:copied.owner,planHash:verified.value.planHash,lineage,after:-1,checked:0}};
}
/** Retained synthetic evidence is revalidated at original recorded timestamps.
 * It never upgrades legacy signatures, transactions or finality to chain proof. */
export async function verifyRecoveredRecordedExpiry(input,{read,artifacts,crypto,onWorking=(_n)=>{}}){
 const {row:r,history}=structuredClone(input),line=history.lineage.find(value=>value.attemptId===r.attempt_id);need(line,'missing expired attempt lineage.');
 need(Object.entries(r).every(([k,v])=>k==='signature'?v===null:v!==null)&&r.operation_kind===EXPIRE_RECORDED_ATTEMPT&&r.receipt_state==='committed'&&r.principal_key.startsWith('operator:'),'committed binding.');
 const body=JSON.parse(r.input_json),result=JSON.parse(r.result_json),versions=JSON.parse(r.expected_revisions),command=await buildRecordedHeightCommand({kind:'operator',id:r.principal_key.slice(9)},{requestKey:r.request_key,...body},crypto);
 need(canonicalJson(body)===r.input_json&&command.requestDigest===r.request_digest&&r.business_key===r.event_id&&r.result_ref===r.event_id&&r.created_ms===r.recorded_ms,'command identity.');
 need(Object.keys(versions).sort().join(',')==='control,earn,source'&&Object.values(versions).every(v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v))),'revision identities.');
 need(body.intentId===r.intent_id&&body.attemptId===r.attempt_id&&body.evidenceReceiptDigest===r.evidence_receipt_digest&&body.expectedIntentRevision===r.prior_revision&&history.id===r.intent_id&&line.priorRevision===r.prior_revision&&r.attempt_state==='expired'&&r.signature===null&&r.observations===0&&r.message_hash===line.messageHash&&r.last_valid_block_height===line.lastValidBlockHeight&&Number.isSafeInteger(r.block_height)&&r.block_height>line.lastValidBlockHeight,'historical expiry linkage.');
 const expected={eventId:r.event_id,intentId:r.intent_id,attemptId:r.attempt_id,state:'attempt_expired',revision:r.prior_revision+1,blockHeight:r.block_height,lastValidBlockHeight:line.lastValidBlockHeight,messageHash:line.messageHash,source:'local-rehearsal',provenance:'synthetic-recorded-height',legacyAuthority:'unverified',executable:false,financialExecution:false};
 need(canonicalJson(result)===r.result_json&&same(result,expected)&&r.output_digest===await hash(crypto,result),'exact result commitment.');
 const [rows]=await read([sql(`SELECT e.receipt_digest,e.stream_key,e.object_key,e.source_id,e.source_revision,s.config_digest,
 ${bounded('s.config_json',8192,'config_json')},${bounded('e.envelope_json',8192,'envelope_json')},${bounded('e.decision_json',8192,'decision_json')},a.byte_digest,a.size,a.content_type,a.semantic_digest
 FROM app_evidence_receipts e JOIN app_evidence_sources s ON s.source_id=e.source_id AND s.source_revision=e.source_revision
 JOIN app_command_receipts rc ON rc.operation_id=e.operation_id AND rc.state='committed' AND rc.operation_kind='evidence.record-receipt.v1'
 JOIN app_command_receipts sc ON sc.operation_id=s.operation_id AND sc.state='committed' AND sc.operation_kind='evidence.register-source.v1'
 JOIN app_private_artifacts a ON a.object_key=e.object_key WHERE e.receipt_digest=?`,r.evidence_receipt_digest)]);
 need(rows.length===1,'missing original evidence.');const source=rows[0];need([source.config_json,source.envelope_json,source.decision_json].every(v=>typeof v==='string')&&source.size<=4096,'original evidence bound.');
 const identity={key:source.object_key,byteDigest:source.byte_digest,size:source.size,contentType:source.content_type,semanticDigest:source.semantic_digest,visibility:'private'},object=await artifacts.getVerified(identity);need(object?.status==='verified','missing original private bytes.');onWorking((size(r)+size(history)+size(source))*5+object.bytes.length*4);
 const verified=await verifyRecordedTransactionHeight({source:JSON.parse(source.config_json),envelope:JSON.parse(source.envelope_json),decision:JSON.parse(source.decision_json),receiptDigest:source.receipt_digest,bytes:object.bytes},crypto),e=verified.event;
 need(verified.sourceConfigDigest===source.config_digest&&source.config_digest===r.source_config_digest&&verified.byteDigest===source.byte_digest&&source.byte_digest===r.byte_digest&&verified.streamKey===source.stream_key,'retained source identity.');
 need(e.eventId===r.event_id&&e.intentId===r.intent_id&&e.attemptId===r.attempt_id&&e.owner===history.owner&&e.planHash===history.planHash&&e.messageHash===line.messageHash&&e.blockHeight===r.block_height&&BigInt(verified.envelope.contextSlot)>=BigInt(line.contextSlot)&&e.observedMs>=line.observedAtMs&&Number.isSafeInteger(r.recorded_ms)&&r.recorded_ms>=verified.envelope.ingestedAtMs,'historical source event.');
 return {eventId:r.event_id,resultDigest:await hash(crypto,['v2-recorded-expiry',r.operation_id,r.request_digest,r.output_digest,r.evidence_receipt_digest,r.byte_digest,line])};
}
export function createRecoveryV2RecordedExpiryReconciler({driver,artifacts,crypto,repository,onMeasure=(_m)=>{}}){return {async step(loaded,c){
 const retained=size(loaded)+size(c);need(typeof loaded.run.checkpoint_json==='string'&&utf8(loaded.run.checkpoint_json).length<=131072&&size(packRecoveryV2Checkpoint(c))<=131072,'checkpoint bound.');let operations=0,workingBytes=retained*2,maxBatchBytes=0;
 const work=n=>{workingBytes=Math.max(workingBytes,retained*2+n);need(workingBytes<=1048576,'working byte bound.');};
 const read=async statements=>{operations+=statements.length;const measured=measureBatch(statements);maxBatchBytes=Math.max(maxBatchBytes,measured.batchBytes);need(operations<=48&&measured.batchBytes<=262144,'SQL bound.');const rows=(await driver.batch(statements)).map(r=>r.rows),n=size(rows);need(n<=262144,'read bound.');work(n*3);return rows;};
 let delta,check;
 if(!c.recordedExpiryHistory){
  const [next]=await read([sql(`SELECT i.id,${bounded('i.owner',64,'owner')} FROM tx_intents i WHERE i.id>? AND EXISTS(SELECT 1 FROM app_recorded_attempt_expiries o WHERE o.intent_id=i.id) ORDER BY i.id LIMIT 1`,c.recordedExpiryIntent??'')]);
  if(next.length){
   const {id,owner}=next[0],rows=await read(actionRecoveryHistoryStatements(id,owner));need(rows[0].length===1&&rows[1].length===1&&rows[4].length===1,'complete legacy input.');
   const input={row:rows[0][0],count:rows[1][0],attempts:rows[2],receipts:rows[3],keys:rows[4][0],owner,nowMs:c.root.createdMs};work(size(input)*3);
   const verified=await verifyRecordedExpiryHistory(input,crypto),history=verified.history;need(size(history)<=24576,'lineage bound.');
   delta={recordedExpiryHistory:history};check={phase:'recorded-expiry-history',scope:id,ordinal:0,itemCount:1,resultDigest:await hash(crypto,['v2-recorded-expiry-history',id,verified.revision,history.lineage])};
  }else{
   const [counts,proofs]=await read([recordedExpiryCountsSql(),sql("SELECT phase,COUNT(*) n,COALESCE(SUM(item_count),0) items FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase IN ('recorded-expiry-history','recorded-expiry','recorded-expiry-intent') AND target_watermark=? GROUP BY phase",loaded.run.id,c.targetWatermark)]),n=counts[0],get=p=>proofs.find(r=>r.phase===p)??{n:0,items:0};
   need(n.expiries===n.receipts&&get('recorded-expiry').n===n.expiries&&get('recorded-expiry').items===n.expiries&&get('recorded-expiry-history').n===n.intents&&get('recorded-expiry-intent').n===n.intents&&get('recorded-expiry-intent').items===n.expiries,'complete history/receipt coverage.');
   delta={phase:'reconcile-economics',recordedExpiriesComplete:true,recordedExpiryHistory:null,recordedExpiryIntent:null};check={phase:'recorded-expiry-count',scope:'complete',ordinal:0,itemCount:n.expiries,resultDigest:await hash(crypto,['v2-recorded-expiry-count',n])};
  }
 }else{
  const h=c.recordedExpiryHistory;need(size(h)<=24576,'lineage bound.');const [rows]=await read([sidecarSql(h.id,h.after)]);
  if(rows.length){need(rows.length===1||rows[0].prior_revision!==rows[1].prior_revision,'duplicate prior revision.');const r=rows[0],proof=await verifyRecoveredRecordedExpiry({row:r,history:h},{read,artifacts,crypto,onWorking:work});delta={recordedExpiryHistory:{...h,after:r.prior_revision,checked:h.checked+1}};check={phase:'recorded-expiry',scope:r.event_id,ordinal:0,itemCount:1,resultDigest:proof.resultDigest};}
  else{const [counts]=await read([sql('SELECT COUNT(*) n FROM app_recorded_attempt_expiries WHERE intent_id=?',h.id)]);need(counts[0].n===h.checked,'complete intent sidecars.');delta={recordedExpiryIntent:h.id,recordedExpiryHistory:null};check={phase:'recorded-expiry-intent',scope:h.id,ordinal:0,itemCount:h.checked,resultDigest:await hash(crypto,['v2-recorded-expiry-intent',h.id,h.checked,h.lineage])};}
 }
 need(size(packRecoveryV2Checkpoint({...c,...delta}))<=131072,'next checkpoint bound.');onMeasure({operations,workingBytes,maxBatchBytes});return repository.advance(loaded,{delta,targetWatermark:c.targetWatermark,check:{...check,targetWatermark:c.targetWatermark}});
}};}
