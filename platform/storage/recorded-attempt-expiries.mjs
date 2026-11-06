import {canonicalJson} from '../security/canonical.mjs';
import {sql,revisions} from './atomic-driver.mjs';
import {createAtomicReceipts} from './atomic-receipts.mjs';
import {buildRecordedHeightCommand,EXPIRE_RECORDED_ATTEMPT} from '../transactions/recorded-height-service.mjs';
import {verifyRecordedTransactionHeight} from '../transactions/recorded-height-evidence.mjs';
import {createActionRecoveryReadRepository} from '../transactions/recovery-reads.mjs';
const pending=reason=>({kind:'pending',reason,dependencyIds:[]}),conflict=code=>({kind:'conflict',code});
const bound=(column,limit,alias)=>`CASE WHEN length(CAST(${column} AS BLOB))<=${limit} THEN ${column} ELSE NULL END ${alias}`;
const scope="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='evidence-ingest' AND enabled=1)";
/** Retained synthetic block-height expiry only; no submission or replacement. */
export function createRecordedAttemptExpiryRepository(driver,ports){
 const {crypto,clock,store}=ports,{read,replay,execute}=createAtomicReceipts(driver,ports),history=createActionRecoveryReadRepository(driver,ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 async function apply(c){
  const i=c.input;
  const [versions,pins,grants,intents,attempts,evidences]=await read([
   sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),
   sql('SELECT s.mode,s.status,s.generation,s.write_nonce,w.revision watermark FROM app_recovery_state s CROSS JOIN app_recovery_watermark w WHERE s.id=1 AND w.id=1'),
   sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='evidence-ingest'",c.principal.id),
   sql(`SELECT id,owner,action,subject,plan_hash,state,revision,created_ms,${bound('plan',65536,'plan')} FROM tx_intents WHERE id=?`,i.intentId),
   sql(`SELECT id,intent_id,attempt_index,message_hash,blockhash,state,${bound('signature',128,'signature')},${bound('packet',32768,'packet')},${bound('simulation_ref',128,'simulation_ref')} FROM tx_attempts WHERE id=? AND intent_id=?`,i.attemptId,i.intentId),
   sql(`SELECT r.receipt_digest,r.stream_key,r.object_key,r.source_id,r.source_revision,${bound('r.envelope_json',8192,'envelope_json')},${bound('r.decision_json',8192,'decision_json')},s.config_digest,${bound('s.config_json',8192,'config_json')},a.byte_digest,a.size,a.content_type,a.semantic_digest,h.receipt_digest head
    FROM app_evidence_receipts r JOIN app_evidence_sources s ON s.source_id=r.source_id AND s.source_revision=r.source_revision
    JOIN app_command_receipts rc ON rc.operation_id=r.operation_id AND rc.state='committed' AND rc.operation_kind='evidence.record-receipt.v1'
    JOIN app_command_receipts sc ON sc.operation_id=s.operation_id AND sc.state='committed' AND sc.operation_kind='evidence.register-source.v1'
    JOIN app_private_artifacts a ON a.object_key=r.object_key LEFT JOIN app_evidence_heads h ON h.stream_key=r.stream_key WHERE r.receipt_digest=?`,i.evidenceReceiptDigest)
  ]);
  const pin=pins[0],intent=intents[0],attempt=attempts[0],raw=evidences[0];
  if(!pin||!['live','private'].includes(pin.mode)||!['live','ready'].includes(pin.status)||pin.write_nonce!==null)return pending('read-only-recovery');
  if(!intent||!attempt)return pending('recorded-attempt-unavailable');
  if(!raw||![raw.config_json,raw.envelope_json,raw.decision_json,intent.plan,attempt.packet,attempt.simulation_ref].every(v=>typeof v==='string')||raw.size>4096)return pending('height-evidence-unavailable');
  let evidence;
  try{const identity={key:raw.object_key,byteDigest:raw.byte_digest,size:raw.size,contentType:raw.content_type,semanticDigest:raw.semantic_digest,visibility:'private'},object=await store.getVerified(identity);if(object?.status!=='verified')return pending('height-evidence-unavailable');
   evidence=await verifyRecordedTransactionHeight({source:JSON.parse(raw.config_json),envelope:JSON.parse(raw.envelope_json),decision:JSON.parse(raw.decision_json),receiptDigest:raw.receipt_digest,bytes:object.bytes},crypto);
  }catch(error){if(error instanceof TypeError||error instanceof SyntaxError)return pending('height-evidence-invalid');return pending('height-evidence-unavailable');}
  const e=evidence.event;
  if(evidence.sourceConfigDigest!==raw.config_digest||evidence.streamKey!==raw.stream_key||evidence.byteDigest!==raw.byte_digest||e.intentId!==intent.id||e.attemptId!==attempt.id||e.owner!==intent.owner||e.planHash!==intent.plan_hash||e.messageHash!==attempt.message_hash)return conflict('height_attempt_mismatch');
  if(!grants[0]?.enabled)return conflict('operator_scope_required');
  if(raw.head!==raw.receipt_digest)return pending('height-source-changed');
  if(intent.revision!==i.expectedIntentRevision||intent.state!=='awaiting_signature'||attempt.state!=='awaiting_signature'||attempt.signature!==null)return conflict('attempt_expiry_conflict');
  const checked=await history.readRecovery({kind:'wallet',wallet:intent.owner},{intentId:intent.id});
  if(checked.kind!=='ready'||checked.value.currentAttempt?.id!==attempt.id||checked.value.revision!==intent.revision||checked.value.currentAttempt.state!==attempt.state||checked.value.currentAttempt.hasRecordedSignature)return pending('height-history-unverifiable');
  const lastValidBlockHeight=checked.value.currentAttempt.lastValidBlockHeight;
  if(e.blockHeight<=lastValidBlockHeight)return pending('recorded-height-not-expired');
  if(BigInt(evidence.envelope.contextSlot)<BigInt(checked.value.currentAttempt.contextSlot))return pending('height-context-regression');
  const now=clock.nowMs();if(!Number.isSafeInteger(now)||now<evidence.envelope.ingestedAtMs||now>8640000000000000-30000||e.observedMs<checked.value.currentAttempt.observedAtMs)return pending('height-clock-unavailable');
  if(versions.length!==3||new Set(versions.map(r=>r.name)).size!==3||versions.some(r=>!['earn','source','control'].includes(r.name)||!Number.isSafeInteger(Number(r.revision))||!/^(0|[1-9][0-9]*)$/.test(r.revision)))return pending('height-revisions-unavailable');
  const version=revisions(versions),revision=intent.revision+1,result={eventId:e.eventId,intentId:intent.id,attemptId:attempt.id,state:'attempt_expired',revision,blockHeight:e.blockHeight,lastValidBlockHeight,messageHash:attempt.message_hash,source:'local-rehearsal',provenance:'synthetic-recorded-height',legacyAuthority:'unverified',executable:false,financialExecution:false};
  return execute({...c,businessIdentity:e.eventId,nowMs:now,expectedRevisions:version},{businessKey:e.eventId,input:i,result,resultRef:e.eventId,version,
   authoritySql:`${scope} AND EXISTS(SELECT 1 FROM app_recovery_state s CROSS JOIN app_recovery_watermark w WHERE s.id=1 AND w.id=1 AND s.generation=? AND w.revision=? AND s.mode IN ('live','private') AND s.status IN ('live','ready') AND s.write_nonce IS NULL)
    AND ${nowSql}>=? AND ${nowSql}<=?
    AND EXISTS(SELECT 1 FROM tx_intents WHERE id=? AND owner=? AND plan_hash=? AND plan=? AND state=? AND revision=?)
    AND EXISTS(SELECT 1 FROM tx_attempts WHERE id=? AND intent_id=? AND attempt_index=? AND message_hash=? AND blockhash=? AND packet=? AND simulation_ref=? AND signature IS NULL AND state=? AND attempt_index=(SELECT MAX(attempt_index) FROM tx_attempts WHERE intent_id=?))
    AND EXISTS(SELECT 1 FROM app_evidence_heads h JOIN app_evidence_receipts r ON r.receipt_digest=h.receipt_digest JOIN app_evidence_sources s ON s.source_id=r.source_id AND s.source_revision=r.source_revision JOIN app_private_artifacts a ON a.object_key=r.object_key WHERE h.stream_key=? AND r.receipt_digest=? AND r.envelope_json=? AND r.decision_json=? AND s.config_digest=? AND s.config_json=? AND a.byte_digest=? AND a.size=?)
    AND NOT EXISTS(SELECT 1 FROM tx_receipts WHERE attempt_id=?) AND NOT EXISTS(SELECT 1 FROM app_recorded_attempt_expiries WHERE event_id=? OR attempt_id=?)`,
   authorityValues:[c.principal.id,pin.generation,pin.watermark,now,now+30000,intent.id,intent.owner,intent.plan_hash,intent.plan,intent.state,intent.revision,attempt.id,intent.id,attempt.attempt_index,attempt.message_hash,attempt.blockhash,attempt.packet,attempt.simulation_ref,attempt.state,intent.id,raw.stream_key,raw.receipt_digest,raw.envelope_json,raw.decision_json,raw.config_digest,raw.config_json,raw.byte_digest,raw.size,attempt.id,e.eventId,attempt.id],
   child:(gate,g)=>[
    sql(`INSERT INTO app_recorded_attempt_expiries(event_id,intent_id,attempt_id,evidence_receipt_digest,source_config_digest,byte_digest,message_hash,block_height,last_valid_block_height,prior_revision,recorded_ms,operation_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${gate}`,e.eventId,intent.id,attempt.id,raw.receipt_digest,raw.config_digest,raw.byte_digest,attempt.message_hash,e.blockHeight,lastValidBlockHeight,intent.revision,now,g[0],...g),
    sql(`UPDATE tx_intents SET state='attempt_expired',revision=revision+1 WHERE id=? AND state='awaiting_signature' AND revision=? AND ${gate}`,intent.id,intent.revision,...g),
    sql(`UPDATE tx_attempts SET state='expired' WHERE id=? AND intent_id=? AND state='awaiting_signature' AND signature IS NULL AND ${gate}`,attempt.id,intent.id,...g)

   ]});
 }
 async function expire(value){
  const c=structuredClone(value),rebuilt=await buildRecordedHeightCommand(c.principal,{requestKey:c.requestKey,...c.input},crypto);if(canonicalJson(c)!==canonicalJson(rebuilt))throw new TypeError('Invalid recorded height command.');
  const prior=await replay(c);if(prior)return prior;
  const result=await apply(c);
  // A concurrent winner may commit while this attempt verifies old history.
  // Resolve only the exact captured key/body, never invent a successful receipt.
  return ['pending','conflict'].includes(result.kind)?await replay(c)??result:result;
 }
 return Object.freeze({expire});
}
