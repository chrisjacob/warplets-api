import {canonicalJson,utf8} from '../security/canonical.mjs';
import {sql,revisions} from './atomic-driver.mjs';
import {createAtomicReceipts} from './atomic-receipts.mjs';
import {buildRecordedPacketCommand,PREPARE_RECORDED_ATTEMPT} from '../transactions/recorded-packet-service.mjs';
import {verifyRecordedTransactionPacket} from '../transactions/recorded-packet-evidence.mjs';
import {createActionRecoveryReadRepository} from '../transactions/recovery-reads.mjs';
import {validatePacket} from '../transactions/packets.mjs';
const pending=reason=>({kind:'pending',reason,dependencyIds:[]}),conflict=code=>({kind:'conflict',code});
const bound=(column,limit,alias)=>`CASE WHEN length(CAST(${column} AS BLOB))<=${limit} THEN ${column} ELSE NULL END ${alias}`;
const scope="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='evidence-ingest' AND enabled=1)";
/** Imports retained synthetic unsigned packets; never signs, simulates or broadcasts. */
export function createRecordedAttemptPreparationRepository(driver,ports){
 const {crypto,clock,store}=ports,{read,replay,execute}=createAtomicReceipts(driver,ports),history=createActionRecoveryReadRepository(driver,ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 async function apply(c){
  const i=c.input;
  const [versions,pins,grants,intents,attempts,evidences,existingRows]=await read([
   sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),
   sql('SELECT s.mode,s.status,s.generation,s.write_nonce,w.revision watermark FROM app_recovery_state s CROSS JOIN app_recovery_watermark w WHERE s.id=1 AND w.id=1'),
   sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='evidence-ingest'",c.principal.id),
   sql(`SELECT id,owner,action,subject,plan_hash,state,revision,created_ms,${bound('plan',65536,'plan')} FROM tx_intents WHERE id=?`,i.intentId),
   sql(`SELECT id,intent_id,attempt_index,message_hash,blockhash,state,${bound('signature',128,'signature')},${bound('packet',32768,'packet')},${bound('simulation_ref',128,'simulation_ref')} FROM tx_attempts WHERE intent_id=? ORDER BY attempt_index DESC LIMIT 1`,i.intentId),
   sql(`SELECT r.receipt_digest,r.stream_key,r.object_key,r.source_id,r.source_revision,${bound('r.envelope_json',8192,'envelope_json')},${bound('r.decision_json',32768,'decision_json')},s.config_digest,${bound('s.config_json',8192,'config_json')},a.byte_digest,a.size,a.content_type,a.semantic_digest,h.receipt_digest head
    FROM app_evidence_receipts r JOIN app_evidence_sources s ON s.source_id=r.source_id AND s.source_revision=r.source_revision
    JOIN app_command_receipts rc ON rc.operation_id=r.operation_id AND rc.state='committed' AND rc.operation_kind='evidence.record-receipt.v1'
    JOIN app_command_receipts sc ON sc.operation_id=s.operation_id AND sc.state='committed' AND sc.operation_kind='evidence.register-source.v1'
    JOIN app_private_artifacts a ON a.object_key=r.object_key LEFT JOIN app_evidence_heads h ON h.stream_key=r.stream_key WHERE r.receipt_digest=?`,i.evidenceReceiptDigest),
   sql(`SELECT a.id,a.intent_id,a.packet,a.simulation_ref,a.state,p.operation_id FROM tx_attempts a LEFT JOIN app_recorded_attempt_preparations p ON p.attempt_id=a.id WHERE a.id=? AND length(CAST(a.packet AS BLOB))<=32768 AND length(CAST(a.simulation_ref AS BLOB))<=128`,i.attemptId)
  ]);
  const pin=pins[0],intent=intents[0],attempt=attempts[0],raw=evidences[0];
  if(!pin||!['live','private'].includes(pin.mode)||!['live','ready'].includes(pin.status)||pin.write_nonce!==null)return pending('read-only-recovery');
  if(!intent)return pending('recorded-intent-unavailable');
  if(!raw||![raw.config_json,raw.envelope_json,raw.decision_json,intent.plan,...(attempt?[attempt.packet,attempt.simulation_ref]:[])].every(v=>typeof v==='string')||raw.size>32768)return pending('packet-evidence-unavailable');
  let evidence;
  try{const identity={key:raw.object_key,byteDigest:raw.byte_digest,size:raw.size,contentType:raw.content_type,semanticDigest:raw.semantic_digest,visibility:'private'},object=await store.getVerified(identity);if(object?.status!=='verified')return pending('packet-evidence-unavailable');
   evidence=await verifyRecordedTransactionPacket({source:JSON.parse(raw.config_json),envelope:JSON.parse(raw.envelope_json),decision:JSON.parse(raw.decision_json),receiptDigest:raw.receipt_digest,bytes:object.bytes},crypto);
  }catch(error){if(error instanceof TypeError||error instanceof SyntaxError)return pending('packet-evidence-invalid');return pending('packet-evidence-unavailable');}
  const e=evidence.event,packet=e.packet,simulation=e.simulation;
  if(evidence.sourceConfigDigest!==raw.config_digest||evidence.streamKey!==raw.stream_key||evidence.byteDigest!==raw.byte_digest||e.intentId!==intent.id||packet.attemptId!==i.attemptId||e.owner!==intent.owner||e.planHash!==intent.plan_hash)return conflict('packet_attempt_mismatch');
  const packetJson=canonicalJson(packet),existing=existingRows[0];
  if(existing){if(existing.operation_id)return conflict('packet_already_recorded');if(existing.intent_id===intent.id&&existing.packet===packetJson&&existing.simulation_ref===simulation.ref&&['awaiting_signature','expired','submitted','unknown','confirmed','failed','finalized'].includes(existing.state))return {kind:'legacy-replayed',value:{intentId:intent.id,attemptId:existing.id,state:existing.state,source:'local-rehearsal',provenance:'legacy-recorded-unverified',executable:false}};return conflict('packet_attempt_conflict');}
  if(!grants[0]?.enabled)return conflict('operator_scope_required');
  if(raw.head!==raw.receipt_digest)return pending('packet-source-changed');
  if(intent.revision!==i.expectedIntentRevision||!['validated','attempt_expired'].includes(intent.state)||(intent.state==='validated'?!!attempt:!attempt||attempt.state!=='expired'||attempt.signature!==null))return conflict('attempt_preparation_conflict');
  const checked=await history.readRecovery({kind:'wallet',wallet:intent.owner},{intentId:intent.id});
  if(checked.kind!=='ready'||checked.value.revision!==intent.revision||checked.value.state!==intent.state||(checked.value.currentAttempt?.id??null)!==(attempt?.id??null)||checked.value.attemptCount>=16)return pending('packet-history-unverifiable');
  const now=clock.nowMs();if(!Number.isSafeInteger(now)||now<evidence.envelope.ingestedAtMs||now>8640000000000000-30000)return pending('packet-clock-unavailable');
  let plan;try{plan=JSON.parse(intent.plan);if(canonicalJson(plan)!==intent.plan||await crypto.sha256(utf8(intent.plan))!==intent.plan_hash)throw new TypeError('Plan digest');
   if(plan.expiresMs<=now)return pending('recorded-plan-expired');
   if(packet.lookupTables.length)return pending('independent-lookup-evidence-required');
   if(BigInt(simulation.feeUnits)>BigInt(plan.maximumFeeUnits)||BigInt(simulation.outputUnits)<BigInt(plan.minimumOutputUnits))return pending('packet-simulation-bounds');
   await validatePacket(plan,packet.attemptId,intent.plan_hash,packet,now);
  }catch{return pending('packet-verification-failed');}
  if(attempt){const previous=JSON.parse(attempt.packet),expiry=(await read([sql('SELECT block_height FROM app_recorded_attempt_expiries WHERE attempt_id=?',attempt.id)]))[0][0];
   if(packet.messageHash===attempt.message_hash||packet.lifetime.blockhash===attempt.blockhash||packet.lifetime.contextSlot<previous.lifetime.contextSlot||packet.lifetime.observedAt<previous.lifetime.observedAt||simulation.height<=(expiry?expiry.block_height-1:previous.lifetime.lastValidBlockHeight))return pending('packet-replacement-not-fresh');
  }
  if(versions.length!==3||new Set(versions.map(r=>r.name)).size!==3||versions.some(r=>!['earn','source','control'].includes(r.name)||!Number.isSafeInteger(Number(r.revision))||!/^(0|[1-9][0-9]*)$/.test(r.revision)))return pending('packet-revisions-unavailable');
  const version=revisions(versions),revision=intent.revision+1,index=(attempt?.attempt_index??0)+1,packetDigest=await crypto.sha256(utf8(packetJson)),simulationDigest=await crypto.sha256(utf8(canonicalJson(simulation))),result={eventId:e.eventId,intentId:intent.id,attemptId:packet.attemptId,state:'awaiting_signature',revision,index,messageHash:packet.messageHash,packetDigest,simulationDigest,source:'local-rehearsal',provenance:'synthetic-recorded-preparation',legacyAuthority:'unverified',executable:false,financialExecution:false};
  return execute({...c,businessIdentity:e.eventId,nowMs:now,expectedRevisions:version},{businessKey:e.eventId,input:i,result,resultRef:e.eventId,version,
   authoritySql:`${scope} AND EXISTS(SELECT 1 FROM app_recovery_state s CROSS JOIN app_recovery_watermark w WHERE s.id=1 AND w.id=1 AND s.generation=? AND w.revision=? AND s.mode IN ('live','private') AND s.status IN ('live','ready') AND s.write_nonce IS NULL)
    AND ${nowSql}>=? AND ${nowSql}<=? AND ${nowSql}<? AND ${nowSql}<=?
    AND EXISTS(SELECT 1 FROM tx_intents WHERE id=? AND owner=? AND plan_hash=? AND plan=? AND state=? AND revision=?)
    AND (SELECT COALESCE(MAX(attempt_index),0) FROM tx_attempts WHERE intent_id=?)=?
    AND NOT EXISTS(SELECT 1 FROM tx_attempts WHERE id=?)
    AND EXISTS(SELECT 1 FROM app_evidence_heads h JOIN app_evidence_receipts r ON r.receipt_digest=h.receipt_digest JOIN app_evidence_sources s ON s.source_id=r.source_id AND s.source_revision=r.source_revision JOIN app_private_artifacts a ON a.object_key=r.object_key WHERE h.stream_key=? AND r.receipt_digest=? AND r.envelope_json=? AND r.decision_json=? AND s.config_digest=? AND s.config_json=? AND a.byte_digest=? AND a.size=?)
    AND NOT EXISTS(SELECT 1 FROM app_recorded_attempt_preparations WHERE event_id=? OR attempt_id=?)`,
   authorityValues:[c.principal.id,pin.generation,pin.watermark,now,now+30000,plan.expiresMs,packet.lifetime.observedAt+60000,intent.id,intent.owner,intent.plan_hash,intent.plan,intent.state,intent.revision,intent.id,index-1,packet.attemptId,raw.stream_key,raw.receipt_digest,raw.envelope_json,raw.decision_json,raw.config_digest,raw.config_json,raw.byte_digest,raw.size,e.eventId,packet.attemptId],
   child:(gate,g)=>[
    sql(`INSERT INTO tx_attempts(id,intent_id,attempt_index,message_hash,blockhash,packet,simulation_ref,state,signature) SELECT ?,?,?,?,?,?,?,'awaiting_signature',NULL WHERE ${gate}`,packet.attemptId,intent.id,index,packet.messageHash,packet.lifetime.blockhash,packetJson,simulation.ref,...g),
    sql(`INSERT INTO app_recorded_attempt_preparations(attempt_id,event_id,intent_id,evidence_receipt_digest,source_config_digest,byte_digest,message_hash,packet_digest,simulation_digest,prior_state,prior_revision,previous_attempt_id,created_ms,operation_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${gate}`,packet.attemptId,e.eventId,intent.id,raw.receipt_digest,raw.config_digest,raw.byte_digest,packet.messageHash,packetDigest,simulationDigest,intent.state,intent.revision,attempt?.id??null,now,g[0],...g),
    sql(`UPDATE tx_intents SET state='awaiting_signature',revision=revision+1 WHERE id=? AND state=? AND revision=? AND ${gate}`,intent.id,intent.state,intent.revision,...g)
   ]});
 }

 async function prepare(value){
  const c=structuredClone(value),rebuilt=await buildRecordedPacketCommand(c.principal,{requestKey:c.requestKey,...c.input},crypto);if(canonicalJson(c)!==canonicalJson(rebuilt))throw new TypeError('Invalid recorded packet command.');
  const prior=await replay(c);if(prior)return prior;
  const result=await apply(c);
  // A concurrent winner may commit while this attempt verifies old history.
  // Resolve only the exact captured key/body, never invent a successful receipt.
  return ['pending','conflict'].includes(result.kind)?await replay(c)??result:result;
 }
 return Object.freeze({prepare});
}
