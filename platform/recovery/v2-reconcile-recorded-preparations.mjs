import {validatePacket} from '../transactions/packets.mjs';
import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {actionRecoveryHistoryStatements,verifyActionRecoveryHistory} from '../transactions/recovery-reads.mjs';
import {buildRecordedPacketCommand,PREPARE_RECORDED_ATTEMPT} from '../transactions/recorded-packet-service.mjs';
import {verifyRecordedTransactionPacket} from '../transactions/recorded-packet-evidence.mjs';
const need=(ok,reason)=>{if(!ok)throw new TypeError('Recovery recorded preparation '+reason);},size=v=>utf8(canonicalJson(v)).length,hash=(c,v)=>c.sha256(utf8(canonicalJson(v))),same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const bounded=(column,max,alias)=>`CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END ${alias}`;
export const recordedPreparationCountsSql=()=>sql(`SELECT (SELECT COUNT(*) FROM app_recorded_attempt_preparations) preparations,(SELECT COUNT(DISTINCT intent_id) FROM app_recorded_attempt_preparations) intents,(SELECT COUNT(*) FROM app_command_receipts WHERE operation_kind='${PREPARE_RECORDED_ATTEMPT}') receipts`);
const sidecarSql=(intentId,after)=>sql(`SELECT o.*,r.operation_kind,r.principal_key,r.request_key,r.request_digest,r.output_digest,r.result_ref,r.state receipt_state,r.created_ms receipt_created_ms,
 ${bounded('r.input_json',2048,'input_json')},${bounded('r.result_json',2048,'result_json')},${bounded('r.expected_revisions',1024,'expected_revisions')},r.business_key,
 a.state attempt_state,a.signature,${bounded('a.packet',32768,'packet')},${bounded('a.simulation_ref',128,'simulation_ref')},${bounded('i.plan',65536,'plan')}
 FROM app_recorded_attempt_preparations o LEFT JOIN app_command_receipts r ON r.operation_id=o.operation_id LEFT JOIN tx_attempts a ON a.id=o.attempt_id LEFT JOIN tx_intents i ON i.id=o.intent_id
 WHERE o.intent_id=? AND o.prior_revision>? ORDER BY o.prior_revision,o.event_id LIMIT 2`,intentId,after);
export async function verifyRecordedPreparationHistory(input,crypto){
 const copied=structuredClone(input),verified=await verifyActionRecoveryHistory(copied,crypto),lineage=[];
 for(const a of copied.attempts){const packet=JSON.parse(a.packet);lineage.push({attemptId:a.id,index:a.attempt_index,messageHash:a.message_hash,packetDigest:await crypto.sha256(utf8(a.packet)),blockhash:a.blockhash,lastValidBlockHeight:packet.lifetime.lastValidBlockHeight,contextSlot:packet.lifetime.contextSlot,observedAtMs:packet.lifetime.observedAt,priorRevision:2*(a.attempt_index-1),priorState:a.attempt_index===1?'validated':'attempt_expired',previousAttemptId:copied.attempts[a.attempt_index-2]?.id??null});}
 return {revision:verified.value.revision,history:{id:verified.value.id,owner:copied.owner,planHash:verified.value.planHash,lineage,after:-1,checked:0}};
}
/** Retained synthetic evidence is revalidated at original recorded timestamps.
 * It never upgrades legacy signatures, transactions or finality to chain proof. */
export async function verifyRecoveredRecordedPreparation(input,{read,artifacts,crypto,onWorking=(_n)=>{}}){
 const {row:r,history}=structuredClone(input),line=history.lineage.find(value=>value.attemptId===r.attempt_id);need(line,'missing prepared attempt lineage.');
 need(Object.entries(r).every(([k,v])=>k==='signature'?v===null:k==='previous_attempt_id'?v===null||typeof v==='string':v!==null)&&r.operation_kind===PREPARE_RECORDED_ATTEMPT&&r.receipt_state==='committed'&&r.principal_key.startsWith('operator:'),'committed binding.');
 const body=JSON.parse(r.input_json),result=JSON.parse(r.result_json),versions=JSON.parse(r.expected_revisions),command=await buildRecordedPacketCommand({kind:'operator',id:r.principal_key.slice(9)},{requestKey:r.request_key,...body},crypto);
 need(canonicalJson(body)===r.input_json&&command.requestDigest===r.request_digest&&r.business_key===r.event_id&&r.result_ref===r.event_id&&r.receipt_created_ms===r.created_ms,'command identity.');
 need(Object.keys(versions).sort().join(',')==='control,earn,source'&&Object.values(versions).every(v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v))),'revision identities.');
 need(body.intentId===r.intent_id&&body.attemptId===r.attempt_id&&body.evidenceReceiptDigest===r.evidence_receipt_digest&&body.expectedIntentRevision===r.prior_revision&&history.id===r.intent_id&&line.priorRevision===r.prior_revision&&line.priorState===r.prior_state&&line.previousAttemptId===r.previous_attempt_id&&['awaiting_signature','expired'].includes(r.attempt_state)&&r.signature===null&&r.message_hash===line.messageHash&&r.packet_digest===line.packetDigest,'historical preparation linkage.');
 const expected={eventId:r.event_id,intentId:r.intent_id,attemptId:r.attempt_id,state:'awaiting_signature',revision:r.prior_revision+1,index:line.index,messageHash:line.messageHash,packetDigest:r.packet_digest,simulationDigest:r.simulation_digest,source:'local-rehearsal',provenance:'synthetic-recorded-preparation',legacyAuthority:'unverified',executable:false,financialExecution:false};
 need(canonicalJson(result)===r.result_json&&same(result,expected)&&r.output_digest===await hash(crypto,result),'exact result commitment.');
 const [rows]=await read([sql(`SELECT e.receipt_digest,e.stream_key,e.object_key,e.source_id,e.source_revision,s.config_digest,
 ${bounded('s.config_json',8192,'config_json')},${bounded('e.envelope_json',8192,'envelope_json')},${bounded('e.decision_json',32768,'decision_json')},a.byte_digest,a.size,a.content_type,a.semantic_digest
 FROM app_evidence_receipts e JOIN app_evidence_sources s ON s.source_id=e.source_id AND s.source_revision=e.source_revision
 JOIN app_command_receipts rc ON rc.operation_id=e.operation_id AND rc.state='committed' AND rc.operation_kind='evidence.record-receipt.v1'
 JOIN app_command_receipts sc ON sc.operation_id=s.operation_id AND sc.state='committed' AND sc.operation_kind='evidence.register-source.v1'
 JOIN app_private_artifacts a ON a.object_key=e.object_key WHERE e.receipt_digest=?`,r.evidence_receipt_digest)]);
 need(rows.length===1,'missing original evidence.');const source=rows[0];need([source.config_json,source.envelope_json,source.decision_json].every(v=>typeof v==='string')&&source.size<=32768,'original evidence bound.');
 const identity={key:source.object_key,byteDigest:source.byte_digest,size:source.size,contentType:source.content_type,semanticDigest:source.semantic_digest,visibility:'private'},object=await artifacts.getVerified(identity);need(object?.status==='verified','missing original private bytes.');onWorking((size(r)+size(history)+size(source))*5+object.bytes.length*4);
 const verified=await verifyRecordedTransactionPacket({source:JSON.parse(source.config_json),envelope:JSON.parse(source.envelope_json),decision:JSON.parse(source.decision_json),receiptDigest:source.receipt_digest,bytes:object.bytes},crypto),e=verified.event;
 need(verified.sourceConfigDigest===source.config_digest&&source.config_digest===r.source_config_digest&&verified.byteDigest===source.byte_digest&&source.byte_digest===r.byte_digest&&verified.streamKey===source.stream_key,'retained source identity.');
 const packet=e.packet,simulation=e.simulation,plan=JSON.parse(r.plan);
 need(e.eventId===r.event_id&&e.intentId===r.intent_id&&packet.attemptId===r.attempt_id&&e.owner===history.owner&&e.planHash===history.planHash&&packet.messageHash===line.messageHash&&Number.isSafeInteger(r.created_ms)&&r.created_ms>=verified.envelope.ingestedAtMs,'historical source event.');
 need(canonicalJson(packet)===r.packet&&await hash(crypto,packet)===r.packet_digest&&await hash(crypto,simulation)===r.simulation_digest&&simulation.ref===r.simulation_ref&&canonicalJson(plan)===r.plan&&await crypto.sha256(utf8(r.plan))===history.planHash,'original packet/simulation/plan.');
 need(packet.lookupTables.length===0&&simulation.lookupTables.length===0&&plan.expiresMs>r.created_ms&&BigInt(simulation.feeUnits)<=BigInt(plan.maximumFeeUnits)&&BigInt(simulation.outputUnits)>=BigInt(plan.minimumOutputUnits),'original preparation policy.');
 await validatePacket(plan,packet.attemptId,history.planHash,packet,r.created_ms);
 if(line.previousAttemptId){const previous=history.lineage.find(x=>x.attemptId===line.previousAttemptId);need(previous&&previous.index===line.index-1,'previous attempt lineage.');const [expiries]=await read([sql('SELECT block_height FROM app_recorded_attempt_expiries WHERE attempt_id=?',line.previousAttemptId)]);
  need(expiries.length<=1&&line.messageHash!==previous.messageHash&&line.blockhash!==previous.blockhash&&line.contextSlot>=previous.contextSlot&&line.observedAtMs>=previous.observedAtMs&&simulation.height>(expiries[0]?expiries[0].block_height-1:previous.lastValidBlockHeight),'original replacement freshness.');
 }
 return {eventId:r.event_id,resultDigest:await hash(crypto,['v2-recorded-preparation',r.operation_id,r.request_digest,r.output_digest,r.evidence_receipt_digest,r.packet_digest,r.simulation_digest,line])};
}
export function createRecoveryV2RecordedPreparationReconciler({driver,artifacts,crypto,repository,onMeasure=(_m)=>{}}){return {async step(loaded,c){
 const retained=size(loaded)+size(c);need(size(c)<=131072,'checkpoint bound.');let operations=0,workingBytes=retained*2,maxBatchBytes=0;
 const work=n=>{workingBytes=Math.max(workingBytes,retained*2+n);need(workingBytes<=1048576,'working byte bound.');};
 const read=async statements=>{operations+=statements.length;const measured=measureBatch(statements);maxBatchBytes=Math.max(maxBatchBytes,measured.batchBytes);need(operations<=48&&measured.batchBytes<=262144,'SQL bound.');const rows=(await driver.batch(statements)).map(r=>r.rows),n=size(rows);need(n<=262144,'read bound.');work(n*3);return rows;};
 let delta,check;
 if(!c.recordedPreparationHistory){
  const [next]=await read([sql(`SELECT i.id,${bounded('i.owner',64,'owner')} FROM tx_intents i WHERE i.id>? AND EXISTS(SELECT 1 FROM app_recorded_attempt_preparations o WHERE o.intent_id=i.id) ORDER BY i.id LIMIT 1`,c.recordedPreparationIntent??'')]);
  if(next.length){
   const {id,owner}=next[0],rows=await read(actionRecoveryHistoryStatements(id,owner));need(rows[0].length===1&&rows[1].length===1&&rows[4].length===1,'complete legacy input.');
   const input={row:rows[0][0],count:rows[1][0],attempts:rows[2],receipts:rows[3],keys:rows[4][0],owner,nowMs:c.root.createdMs};work(size(input)*3);
   const verified=await verifyRecordedPreparationHistory(input,crypto),history=verified.history;need(size(history)<=24576,'lineage bound.');
   delta={recordedPreparationHistory:history};check={phase:'recorded-preparation-history',scope:id,ordinal:0,itemCount:1,resultDigest:await hash(crypto,['v2-recorded-preparation-history',id,verified.revision,history.lineage])};
  }else{
   const [counts,proofs]=await read([recordedPreparationCountsSql(),sql("SELECT phase,COUNT(*) n,COALESCE(SUM(item_count),0) items FROM app_recovery_reconcile_checks WHERE restore_id=? AND phase IN ('recorded-preparation-history','recorded-preparation','recorded-preparation-intent') AND target_watermark=? GROUP BY phase",loaded.run.id,c.targetWatermark)]),n=counts[0],get=p=>proofs.find(r=>r.phase===p)??{n:0,items:0};
   need(n.preparations===n.receipts&&get('recorded-preparation').n===n.preparations&&get('recorded-preparation').items===n.preparations&&get('recorded-preparation-history').n===n.intents&&get('recorded-preparation-intent').n===n.intents&&get('recorded-preparation-intent').items===n.preparations,'complete history/receipt coverage.');
   delta={phase:'reconcile-economics',recordedPreparationsComplete:true,recordedPreparationHistory:null,recordedPreparationIntent:null};check={phase:'recorded-preparation-count',scope:'complete',ordinal:0,itemCount:n.preparations,resultDigest:await hash(crypto,['v2-recorded-preparation-count',n])};
  }
 }else{
  const h=c.recordedPreparationHistory;need(size(h)<=24576,'lineage bound.');const [rows]=await read([sidecarSql(h.id,h.after)]);
  if(rows.length){need(rows.length===1||rows[0].prior_revision!==rows[1].prior_revision,'duplicate prior revision.');const r=rows[0],proof=await verifyRecoveredRecordedPreparation({row:r,history:h},{read,artifacts,crypto,onWorking:work});delta={recordedPreparationHistory:{...h,after:r.prior_revision,checked:h.checked+1}};check={phase:'recorded-preparation',scope:r.event_id,ordinal:0,itemCount:1,resultDigest:proof.resultDigest};}
  else{const [counts]=await read([sql('SELECT COUNT(*) n FROM app_recorded_attempt_preparations WHERE intent_id=?',h.id)]);need(counts[0].n===h.checked,'complete intent sidecars.');delta={recordedPreparationIntent:h.id,recordedPreparationHistory:null};check={phase:'recorded-preparation-intent',scope:h.id,ordinal:0,itemCount:h.checked,resultDigest:await hash(crypto,['v2-recorded-preparation-intent',h.id,h.checked,h.lineage])};}
 }
 need(size({...c,...delta})<=131072,'next checkpoint bound.');onMeasure({operations,workingBytes,maxBatchBytes});return repository.advance(loaded,{delta,targetWatermark:c.targetWatermark,check:{...check,targetWatermark:c.targetWatermark}});
}};}
