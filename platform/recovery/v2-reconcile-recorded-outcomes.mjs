import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {actionRecoveryHistoryStatements,verifyActionRecoveryHistory} from '../transactions/recovery-reads.mjs';
import {buildRecordedOutcomeCommand,RECORD_TRANSACTION_OUTCOME} from '../transactions/recorded-outcome-service.mjs';
import {verifyRecordedTransactionOutcome} from '../transactions/recorded-outcome-evidence.mjs';
const need=(ok,reason)=>{if(!ok)throw new TypeError('Recovery recorded outcome '+reason);},size=v=>utf8(canonicalJson(v)).length,hash=(c,v)=>c.sha256(utf8(canonicalJson(v))),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const bounded=(column,max,alias)=>`CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END ${alias}`;
const names=['eventId','attemptId','ordinal','priorState','priorRevision','revision','observationDigest'];
export const recordedOutcomeCountsSql=()=>sql(`SELECT (SELECT COUNT(*) FROM app_recorded_transaction_outcomes) outcomes,(SELECT COUNT(DISTINCT intent_id) FROM app_recorded_transaction_outcomes) intents,(SELECT COUNT(*) FROM app_command_receipts WHERE operation_kind='${RECORD_TRANSACTION_OUTCOME}') receipts`);
const sidecarSql=(intentId,after)=>sql(`SELECT o.*,r.operation_kind,r.principal_key,r.request_key,r.request_digest,r.output_digest,r.result_ref,r.state receipt_state,r.created_ms,
 ${bounded('r.input_json',2048,'input_json')},${bounded('r.result_json',2048,'result_json')},${bounded('r.expected_revisions',1024,'expected_revisions')},r.business_key,
 ${bounded('t.observation',2048,'observation')},t.state observation_state,t.rowid observation_ordinal
 FROM app_recorded_transaction_outcomes o LEFT JOIN app_command_receipts r ON r.operation_id=o.operation_id LEFT JOIN tx_receipts t ON t.event_id=o.event_id
 WHERE o.intent_id=? AND o.prior_revision>? ORDER BY o.prior_revision,o.event_id LIMIT 2`,intentId,after);
/** Retained synthetic evidence is revalidated at original recorded timestamps.
 * It never upgrades legacy signatures, transactions or finality to chain proof. */
export async function verifyRecoveredRecordedOutcome(input,{read,artifacts,crypto,onWorking=(_n)=>{}}){
 const {row:r,history}=structuredClone(input),line=history.lineage.find(tuple=>tuple[0]===r.event_id);need(line,'missing event lineage.');const eventLineage=Object.fromEntries(names.map((key,index)=>[key,line[index]]));
 need(Object.values(r).every(v=>v!==null)&&r.operation_kind===RECORD_TRANSACTION_OUTCOME&&r.receipt_state==='committed'&&r.principal_key.startsWith('operator:'),'committed binding.');
 const body=JSON.parse(r.input_json),result=JSON.parse(r.result_json),versions=JSON.parse(r.expected_revisions),command=await buildRecordedOutcomeCommand({kind:'operator',id:r.principal_key.slice(9)},{requestKey:r.request_key,...body},crypto);
 need(canonicalJson(body)===r.input_json&&command.requestDigest===r.request_digest&&r.business_key===r.event_id&&r.result_ref===r.event_id&&r.created_ms===r.recorded_ms,'command identity.');
 need(Object.keys(versions).sort().join(',')==='control,earn,source'&&Object.values(versions).every(v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v))),'revision identities.');
 need(body.intentId===r.intent_id&&body.attemptId===r.attempt_id&&body.evidenceReceiptDigest===r.evidence_receipt_digest&&body.expectedIntentRevision===r.prior_revision&&history.id===r.intent_id&&eventLineage.attemptId===r.attempt_id&&eventLineage.ordinal===r.observation_ordinal&&eventLineage.priorState===r.prior_state&&eventLineage.priorRevision===r.prior_revision&&eventLineage.observationDigest===r.observation_digest,'historical event linkage.');
 const expected={eventId:r.event_id,intentId:r.intent_id,attemptId:r.attempt_id,state:r.observation_state,revision:eventLineage.revision,observationDigest:r.observation_digest,source:'local-rehearsal',provenance:'synthetic-recorded-outcome',legacyAuthority:'unverified',executable:false,financialExecution:false};
 need(canonicalJson(result)===r.result_json&&same(result,expected)&&r.output_digest===await hash(crypto,result)&&r.observation_digest===await crypto.sha256(utf8(r.observation)),'exact result/observation commitment.');
 const [rows]=await read([sql(`SELECT e.receipt_digest,e.stream_key,e.object_key,e.source_id,e.source_revision,s.config_digest,
 ${bounded('s.config_json',8192,'config_json')},${bounded('e.envelope_json',8192,'envelope_json')},${bounded('e.decision_json',8192,'decision_json')},a.byte_digest,a.size,a.content_type,a.semantic_digest
 FROM app_evidence_receipts e JOIN app_evidence_sources s ON s.source_id=e.source_id AND s.source_revision=e.source_revision
 JOIN app_command_receipts rc ON rc.operation_id=e.operation_id AND rc.state='committed' AND rc.operation_kind='evidence.record-receipt.v1'
 JOIN app_command_receipts sc ON sc.operation_id=s.operation_id AND sc.state='committed' AND sc.operation_kind='evidence.register-source.v1'
 JOIN app_private_artifacts a ON a.object_key=e.object_key WHERE e.receipt_digest=?`,r.evidence_receipt_digest)]);
 need(rows.length===1,'missing original evidence.');const source=rows[0];need([source.config_json,source.envelope_json,source.decision_json].every(v=>typeof v==='string')&&source.size<=4096,'original evidence bound.');
 const identity={key:source.object_key,byteDigest:source.byte_digest,size:source.size,contentType:source.content_type,semanticDigest:source.semantic_digest,visibility:'private'},object=await artifacts.getVerified(identity);need(object?.status==='verified','missing original private bytes.');onWorking((size(r)+size(history)+size(source))*5+object.bytes.length*4);
 const verified=await verifyRecordedTransactionOutcome({source:JSON.parse(source.config_json),envelope:JSON.parse(source.envelope_json),decision:JSON.parse(source.decision_json),receiptDigest:source.receipt_digest,bytes:object.bytes},crypto),e=verified.event;
 need(verified.sourceConfigDigest===source.config_digest&&source.config_digest===r.source_config_digest&&verified.byteDigest===source.byte_digest&&source.byte_digest===r.byte_digest&&verified.streamKey===source.stream_key&&verified.observationDigest===r.observation_digest&&verified.observationJson===r.observation,'retained source identity.');
 need(e.eventId===r.event_id&&e.intentId===r.intent_id&&e.attemptId===r.attempt_id&&e.owner===history.owner&&e.planHash===history.planHash&&e.state===r.observation_state&&e.attemptId===history.currentAttemptId&&e.observedMs>=history.attemptObservedAtMs&&Number.isSafeInteger(r.recorded_ms)&&r.recorded_ms>=verified.envelope.ingestedAtMs,'historical source event.');
 return {eventId:r.event_id,resultDigest:await hash(crypto,['v2-recorded-outcome',r.operation_id,r.request_digest,r.output_digest,r.evidence_receipt_digest,r.observation_digest,eventLineage])};
}
export function createRecoveryV2RecordedOutcomeReconciler({driver,artifacts,crypto,repository,onMeasure=(_m)=>{}}){return {async step(loaded,c){
 const retained=size(loaded)+size(c);need(size(c)<=131072,'checkpoint bound.');let operations=0,workingBytes=retained*2,maxBatchBytes=0;
 const work=n=>{workingBytes=Math.max(workingBytes,retained*2+n);need(workingBytes<=1048576,'working byte bound.');};
 const read=async statements=>{operations+=statements.length;const measured=measureBatch(statements);maxBatchBytes=Math.max(maxBatchBytes,measured.batchBytes);need(operations<=48&&measured.batchBytes<=262144,'SQL bound.');const rows=(await driver.batch(statements)).map(r=>r.rows),n=size(rows);need(n<=262144,'read bound.');work(n*3);return rows;};
 let delta,check;
 if(!c.recordedOutcomeHistory){
  const [next]=await read([sql(`SELECT i.id,${bounded('i.owner',64,'owner')} FROM tx_intents i WHERE i.id>? AND EXISTS(SELECT 1 FROM app_recorded_transaction_outcomes o WHERE o.intent_id=i.id) ORDER BY i.id LIMIT 1`,c.recordedOutcomeIntent??'')]);
  if(next.length){
   const {id,owner}=next[0],rows=await read(actionRecoveryHistoryStatements(id,owner));need(rows[0].length===1&&rows[1].length===1&&rows[4].length===1,'complete legacy input.');
   const input={row:rows[0][0],count:rows[1][0],attempts:rows[2],receipts:rows[3],keys:rows[4][0],owner,nowMs:c.root.createdMs};work(size(input)*3);
   const verified=await verifyActionRecoveryHistory(input,crypto),history={id,owner,planHash:verified.value.planHash,currentAttemptId:verified.value.currentAttempt?.id??null,attemptObservedAtMs:verified.value.currentAttempt?.observedAtMs??null,lineage:verified.eventLineage.map(e=>names.map(n=>e[n])),after:-1,checked:0};need(size(history)<=24576,'lineage bound.');
   delta={recordedOutcomeHistory:history};check={phase:'recorded-outcome-history',scope:id,ordinal:0,itemCount:1,resultDigest:await hash(crypto,['v2-recorded-outcome-history',id,verified.value.revision,history.lineage])};
  }else{
   const [counts,proofs]=await read([recordedOutcomeCountsSql(),sql("SELECT phase,COUNT(*) n,COALESCE(SUM(item_count),0) items FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase IN ('recorded-outcome-history','recorded-outcome','recorded-outcome-intent') AND target_watermark=? GROUP BY phase",loaded.run.id,c.targetWatermark)]),n=counts[0],get=p=>proofs.find(r=>r.phase===p)??{n:0,items:0};
   need(n.outcomes===n.receipts&&get('recorded-outcome').n===n.outcomes&&get('recorded-outcome').items===n.outcomes&&get('recorded-outcome-history').n===n.intents&&get('recorded-outcome-intent').n===n.intents&&get('recorded-outcome-intent').items===n.outcomes,'complete history/receipt coverage.');
   delta={phase:'reconcile-economics',recordedOutcomesComplete:true,recordedOutcomeHistory:null,recordedOutcomeIntent:null};check={phase:'recorded-outcome-count',scope:'complete',ordinal:0,itemCount:n.outcomes,resultDigest:await hash(crypto,['v2-recorded-outcome-count',n])};
  }
 }else{
  const h=c.recordedOutcomeHistory;need(size(h)<=24576,'lineage bound.');const [rows]=await read([sidecarSql(h.id,h.after)]);
  if(rows.length){need(rows.length===1||rows[0].prior_revision!==rows[1].prior_revision,'duplicate prior revision.');const r=rows[0],proof=await verifyRecoveredRecordedOutcome({row:r,history:h},{read,artifacts,crypto,onWorking:work});delta={recordedOutcomeHistory:{...h,after:r.prior_revision,checked:h.checked+1}};check={phase:'recorded-outcome',scope:r.event_id,ordinal:0,itemCount:1,resultDigest:proof.resultDigest};}
  else{const [counts]=await read([sql('SELECT COUNT(*) n FROM app_recorded_transaction_outcomes WHERE intent_id=?',h.id)]);need(counts[0].n===h.checked,'complete intent sidecars.');delta={recordedOutcomeIntent:h.id,recordedOutcomeHistory:null};check={phase:'recorded-outcome-intent',scope:h.id,ordinal:0,itemCount:h.checked,resultDigest:await hash(crypto,['v2-recorded-outcome-intent',h.id,h.checked,h.lineage])};}
 }
 need(size({...c,...delta})<=131072,'next checkpoint bound.');onMeasure({operations,workingBytes,maxBatchBytes});return repository.advance(loaded,{delta,targetWatermark:c.targetWatermark,check:{...check,targetWatermark:c.targetWatermark}});
}};}
