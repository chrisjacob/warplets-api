import {sql,measureBatch} from '../storage/atomic-driver.mjs';
import {canonical} from './canonical.mjs';
import {validatePacket} from './packets.mjs';
import {decode58,encode58} from '../server/base58.mjs';
import {utf8} from '../security/canonical.mjs';
export const ACTION_RECOVERY_LIMITS=Object.freeze({attempts:16,receipts:64,planBytes:65536,packetBytes:32768,observationBytes:2048,resultBytes:262144,outputBytes:32768,statements:8});
const actions=['launch','fund','claim','stake','unstake','harvest','swap'],states=['validated','attempt_expired','awaiting_signature','submitted','unknown','confirmed','failed','finalized'],receiptStates=['unknown','confirmed','failed','finalized'];
const transitions={submitted:['unknown','confirmed','failed','finalized'],unknown:['confirmed','failed','finalized'],confirmed:['unknown','failed','finalized']};
const nat=v=>Number.isSafeInteger(v)&&v>=0,name=v=>typeof v==='string'&&/^[a-zA-Z0-9:_./-]{1,128}$/.test(v),hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),need=v=>{if(!v)throw Error('Inconsistent retained transaction history.');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const frozen=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(frozen);Object.freeze(v);}return v;};
const fence=()=>sql('SELECT w.revision watermark,s.generation,s.mode,s.status FROM app_recovery_watermark w JOIN app_recovery_state s ON s.id=w.id WHERE w.id=1');
const bounded=(column,max)=>`CASE WHEN length(CAST(${column} AS BLOB))<=${max} THEN ${column} ELSE NULL END ${column}`;
const pending=reason=>Object.freeze({kind:'pending',reason});
export function actionRecoveryHistoryStatements(intentId,wallet){
 if(!name(intentId))throw new TypeError('Exact intent ID required.');decode58(wallet,32);const owner=[intentId,wallet],scope='SELECT id FROM tx_intents WHERE id=? AND owner=?';
 return [
   sql(`SELECT id,owner,action,subject,state,revision,plan_hash,created_ms,${bounded('plan',ACTION_RECOVERY_LIMITS.planBytes)} FROM tx_intents WHERE id=? AND owner=?`,...owner),
   sql(`SELECT COUNT(*) attempts,COALESCE(MAX(attempt_index),0) lastIndex FROM tx_attempts WHERE intent_id IN (${scope})`,...owner),
   sql(`SELECT id,intent_id,attempt_index,message_hash,blockhash,state,${bounded('signature',128)},${bounded('simulation_ref',128)},${bounded('packet',ACTION_RECOVERY_LIMITS.packetBytes)} FROM tx_attempts WHERE intent_id IN (${scope}) ORDER BY attempt_index LIMIT 17`,...owner),
   sql(`SELECT r.rowid ordinal,r.event_id,r.attempt_id,r.state,${bounded('observation',ACTION_RECOVERY_LIMITS.observationBytes)} FROM tx_receipts r JOIN tx_attempts a ON a.id=r.attempt_id WHERE a.intent_id IN (${scope}) ORDER BY r.rowid LIMIT 65`,...owner),
   sql(`SELECT COUNT(*) requests,COALESCE(SUM(CASE WHEN k.owner=i.owner AND k.action=i.action AND length(k.request_key) BETWEEN 1 AND 128 THEN 0 ELSE 1 END),0) bad FROM tx_request_keys k JOIN tx_intents i ON i.id=k.intent_id WHERE i.id=? AND i.owner=?`,...owner)];
}

/** Pure bounded legacy consistency, never signature or chain authenticity.
 * eventLineage is private recovery metadata and is not part of the public DTO. */
export async function verifyActionRecoveryHistory(input,crypto){
 const {row,attempts,receipts,count,keys,owner,nowMs:now}=structuredClone(input);
 need(nat(now)&&now<=8640000000000000&&Array.isArray(attempts)&&attempts.length<=16&&Array.isArray(receipts)&&receipts.length<=64&&count.attempts<=16&&row.plan!==null&&attempts.every(a=>a.packet!==null&&a.simulation_ref!==null)&&receipts.every(r=>r.observation!==null));
   need(nat(count.attempts)&&count.attempts===attempts.length&&count.lastIndex===attempts.length&&nat(keys.requests)&&keys.requests>=1&&keys.bad===0&&name(row.id)&&row.owner===owner&&actions.includes(row.action)&&name(row.subject)&&states.includes(row.state)&&nat(row.revision)&&nat(row.created_ms)&&row.created_ms<=now&&hash(row.plan_hash));
   const plan=JSON.parse(row.plan);need(canonical(plan)===row.plan&&await crypto.sha256(utf8(row.plan))===row.plan_hash&&exact(plan,['network','action','subject','expiresMs','maximumFeeUnits','minimumOutputUnits','signers','instructions'])&&plan.network==='solana-local'&&plan.action===row.action&&plan.subject===row.subject&&nat(plan.expiresMs)&&plan.expiresMs>0&&Array.isArray(plan.signers)&&plan.signers[0]===owner&&plan.signers.length>=1&&plan.signers.length<=4&&new Set(plan.signers).size===plan.signers.length&&Array.isArray(plan.instructions)&&plan.instructions.length>=1&&plan.instructions.length<=16);
   for(const amount of [plan.maximumFeeUnits,plan.minimumOutputUnits])need(typeof amount==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(amount)&&BigInt(amount)<2n**64n);for(const signer of plan.signers)decode58(signer,32);
   for(const instruction of plan.instructions){need(exact(instruction,['program','accounts','data'])&&Array.isArray(instruction.accounts)&&instruction.accounts.length<=64&&typeof instruction.data==='string'&&/^(?:[a-f0-9]{2}){0,1232}$/.test(instruction.data));decode58(instruction.program,32);for(const account of instruction.accounts){need(exact(account,['address','signer','writable'])&&typeof account.signer==='boolean'&&typeof account.writable==='boolean');decode58(account.address,32);}}
   const localGenesis=encode58(new Uint8Array((await crypto.sha256(utf8('10x-offline-rehearsal-1'))).match(/../g).map(v=>parseInt(v,16))));let current=null,expectedRevision=attempts.length;const eventLineage=[];
   for(let index=0;index<attempts.length;index++){
    const a=attempts[index];need(name(a.id)&&a.intent_id===row.id&&a.attempt_index===index+1&&hash(a.message_hash)&&name(a.simulation_ref)&&['expired','awaiting_signature','submitted',...receiptStates].includes(a.state));decode58(a.blockhash,32);if(index<attempts.length-1)need(a.state==='expired');if(index)need(a.blockhash!==attempts[index-1].blockhash);
    const packet=JSON.parse(a.packet);need(canonical(packet)===a.packet&&packet.messageHash===a.message_hash&&packet.lifetime?.blockhash===a.blockhash&&packet.genesisHash===localGenesis&&nat(packet.lifetime?.observedAt));await validatePacket(plan,a.id,row.plan_hash,packet,packet.lifetime.observedAt);
    const signed=a.signature!==null,events=receipts.filter(r=>r.attempt_id===a.id);let state=signed?'submitted':a.state;
    if(signed){decode58(a.signature,64);need(!['expired','awaiting_signature'].includes(a.state));expectedRevision++;}else need(['expired','awaiting_signature'].includes(a.state)&&events.length===0);
    if(a.state==='expired')expectedRevision++;
    for(const event of events){const observation=JSON.parse(event.observation);need(nat(event.ordinal)&&event.ordinal>0&&name(event.event_id)&&receiptStates.includes(event.state)&&exact(observation,['attemptId','signature','state','genesisHash','messageHash'])&&canonical(observation)===event.observation&&observation.attemptId===a.id&&observation.signature===a.signature&&observation.state===event.state&&observation.genesisHash===localGenesis&&observation.messageHash===a.message_hash&&transitions[state]?.includes(event.state));eventLineage.push({eventId:event.event_id,attemptId:a.id,ordinal:event.ordinal,priorState:state,priorRevision:expectedRevision,revision:expectedRevision+1,observationDigest:await crypto.sha256(utf8(event.observation))});state=event.state;expectedRevision++;}
    need(state===a.state);current={id:a.id,index:a.attempt_index,state:a.state,messageHash:a.message_hash,blockhash:a.blockhash,lastValidBlockHeight:packet.lifetime.lastValidBlockHeight,contextSlot:packet.lifetime.contextSlot,observedAtMs:packet.lifetime.observedAt,hasRecordedSignature:signed};
   }
   need(receipts.every(r=>attempts.some(a=>a.id===r.attempt_id))&&row.revision===expectedRevision);if(!current)need(row.state==='validated');else need(row.state===(current.state==='expired'?'attempt_expired':current.state));
   const replacementEligible=row.state==='attempt_expired'&&current?.state==='expired'&&!current.hasRecordedSignature&&plan.expiresMs>now;
   let nextLocalTransition='none',requiredObservation=null;
   if(['submitted','unknown','confirmed'].includes(row.state)){nextLocalTransition='reconcile-existing-attempt';requiredObservation='same-attempt-recorded-outcome';}
   else if(replacementEligible){nextLocalTransition='replace-expired-unsubmitted';requiredObservation='fresh-verified-preparation';}
   else if(row.state==='validated'&&plan.expiresMs>now){nextLocalTransition='prepare-recorded-packet';requiredObservation='fresh-verified-preparation';}
   else if(row.state==='awaiting_signature'){nextLocalTransition='observe-or-expire-unsubmitted';requiredObservation='recorded-block-height-or-submission';}
   const value={id:row.id,action:row.action,subject:row.subject,state:row.state,revision:row.revision,planHash:row.plan_hash,createdAtMs:row.created_ms,planExpiresAtMs:plan.expiresMs,asOfMs:now,attemptCount:attempts.length,currentAttempt:current,receiptObservations:receipts.map(r=>({eventId:r.event_id,attemptId:r.attempt_id,state:r.state})),nextLocalTransition,requiredObservation,replacementEligible,source:'local-rehearsal',provenance:'legacy-recorded-unverified',executable:false,financialExecution:false};if(utf8(canonical(value)).length>ACTION_RECOVERY_LIMITS.outputBytes)throw Error('Retained transaction history bound.');return frozen({value,eventLineage});
}

/** Read-only legacy evidence guidance. Packet equality and recorded signature
 * linkage are checked, but no receipt authenticity, execution or replacement
 * authority is granted. The complete bounded history is required. */
export function createActionRecoveryReadRepository(driver,{crypto,clock}){
 return Object.freeze({async readRecovery(principal,query){
  const p=structuredClone(principal),q=structuredClone(query),now=clock.nowMs();
  if(!exact(p,['kind','wallet'])||p.kind!=='wallet'||!exact(q,['intentId'])||!name(q.intentId)||!nat(now)||now>8640000000000000)throw new TypeError('A wallet principal and exact intent ID are required.');decode58(p.wallet,32);
  const statements=[fence(),...actionRecoveryHistoryStatements(q.intentId,p.wallet),fence()];
  measureBatch(statements);
  try{
   const batches=await driver.batch(statements);need(Array.isArray(batches)&&batches.length===7&&batches.every(r=>Array.isArray(r.rows)));const rows=batches.map(r=>r.rows),bytes=utf8(canonical(rows)).length;
   if(bytes>ACTION_RECOVERY_LIMITS.resultBytes)return pending('history-bound');
   need(rows[0].length===1&&rows[6].length===1);const pin=rows[0][0];if(canonical(pin)!==canonical(rows[6][0]))return pending('snapshot-changed');
   need(nat(pin.watermark)&&typeof pin.generation==='string'&&['live','private','public'].includes(pin.mode)&&['live','restoring','ready','held'].includes(pin.status));if(['restoring','held'].includes(pin.status))return pending('recovery-in-progress');
   if(!rows[1].length)return Object.freeze({kind:'not-found'});need(rows[1].length===1&&rows[2].length===1&&rows[5].length===1);
   const row=rows[1][0],attempts=rows[3],receipts=rows[4],count=rows[2][0],keys=rows[5][0];
   if(count.attempts>16||attempts.length>16||receipts.length>64||row.plan===null||attempts.some(a=>a.packet===null||a.simulation_ref===null)||receipts.some(r=>r.observation===null))return pending('history-bound');
   const {value}=await verifyActionRecoveryHistory({row,attempts,receipts,count,keys,owner:p.wallet,nowMs:now},crypto);
   const final=await driver.batch([fence()]);need(final.length===1&&final[0].rows.length===1);if(canonical(final[0].rows[0])!==canonical(pin))return pending('snapshot-changed');
   return frozen({kind:'ready',value});
  }catch(error){return pending(error?.message==='Retained transaction history bound.'?'history-bound':error instanceof SyntaxError||error?.message==='Inconsistent retained transaction history.'?'history-inconsistent':'snapshot-unavailable');}
 }});
}
