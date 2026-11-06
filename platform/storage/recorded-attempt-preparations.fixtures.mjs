import {randomUUID,createHash} from 'node:crypto';
import {encode58} from '../server/base58.mjs';
import {openDatabase} from './database.mjs';
import {createNodeAtomicDriver} from './node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {memoryArtifacts} from '../recovery/fixtures.mjs';
import {recoveryReadFixture} from '../transactions/recovery-read.fixtures.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createRecordedReader} from '../evidence/recorded.mjs';
import {createEvidenceService} from '../evidence/service.mjs';
import {createEvidenceRepository} from '../evidence/repository.mjs';
import {createArtifactReferenceRepository} from './atomic-artifacts.mjs';
import {RECORDED_PACKET_DECODER} from '../transactions/recorded-packet-evidence.mjs';
import {LOCAL_REHEARSAL_GENESIS} from '../transactions/recorded-outcome-evidence.mjs';
import {createRecordedPacketService} from '../transactions/recorded-packet-service.mjs';
import {createRecordedAttemptPreparationRepository} from './recorded-attempt-preparations.mjs';
export const RECORDED_PACKET_TEST_PRINCIPAL={kind:'operator',id:'synthetic-packet-recorder'};
/** Actual retained local history; fixed synthetic signature labels, never signing. */
export async function recordedPacketFixture(t,{state='validated',attemptCount=1}={}){
 const db=openDatabase();t.after(()=>db.close());
 const legacy=await recoveryReadFixture(db,{state,attemptCount}),initialLegacy=legacy.dump(),crypto=createNodeCrypto(),store=memoryArtifacts(),principal=RECORDED_PACKET_TEST_PRINCIPAL;let now=legacy.now+100,head=null,fault=null,fired=0;
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'evidence-ingest');db.function('synthetic_packet_clock',()=>now);
 const raw={...createNodeAtomicDriver(db),leaseNowSql:'synthetic_packet_clock()'},metrics={sqlStatements:0};
 const driver={...raw,async batch(statements){metrics.sqlStatements+=statements.length;const commit=statements.some(s=>s.sql.startsWith('INSERT INTO app_recorded_attempt_preparations'));
  if(commit){if(fault?.startsWith('omit-')){const targets={'omit-binding':'INSERT INTO app_recorded_attempt_preparations','omit-intent':'UPDATE tx_intents','omit-attempt':'INSERT INTO tx_attempts'};statements=statements.filter(s=>!s.sql.startsWith(targets[fault]));fired++;}
   if(fault==='alter-digest'){statements=statements.map(s=>s.sql.startsWith('INSERT INTO app_recorded_attempt_preparations')?{...s,values:s.values.map((v,index)=>index===7?'f'.repeat(64):v)}:s);fired++;}
   if(fault==='clock'){now+=30001;fired++;}
   if(fault==='scope'){db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(principal.id);fired++;}
   if(fault==='head'){db.prepare('DELETE FROM app_evidence_heads').run();fired++;}
  }const out=await raw.batch(statements);if(commit&&fault==='lose'){fired++;throw Error('Synthetic committed outcome response lost');}return out;}};
 const packet=packetRecording(legacy,{attemptId:'synthetic-imported-1'}),attempt=packet;
 const policy={intentId:legacy.intent.id,attemptId:packet.attemptId,owner:legacy.owner,planHash:legacy.intent.planHash,messageHash:packet.messageHash},subject={kind:'transaction-attempt',id:packet.attemptId};
 const simulation=simulationRecording(packet),payload={version:1,mode:'synthetic-fixture',eventId:'packet-event-1',intentId:legacy.intent.id,owner:legacy.owner,planHash:legacy.intent.planHash,packet,simulation,observedMs:packet.lifetime.observedAt};
 const records=[{id:'packet',subject,contextSlot:String(packet.lifetime.contextSlot),blockTimeMs:payload.observedMs,retrievedAtMs:payload.observedMs,finality:'finalized',bytes:utf8(canonicalJson(payload))}];
 const reader=await createRecordedReader({mode:'synthetic-fixture',chainGenesis:LOCAL_REHEARSAL_GENESIS,records,crypto}),source={version:1,sourceId:'synthetic-packet:'+legacy.intent.id,sourceRevision:'v1',mode:'synthetic-fixture',chainGenesis:LOCAL_REHEARSAL_GENESIS,decoderVersion:RECORDED_PACKET_DECODER,subject,policy,recordingDigest:reader.recordingDigest,maxBytes:32768,maxAgeMs:30000},ports={crypto,ids:{next:randomUUID},clock:{nowMs:()=>now}};
 const evidence=createEvidenceService({...ports,repository:createEvidenceRepository(driver,ports),artifactRepository:createArtifactReferenceRepository(driver,ports),store,readers:new Map([[canonicalJson([source.sourceId,source.sourceRevision]),reader]])}),repository=createRecordedAttemptPreparationRepository(driver,{...ports,store}),service=createRecordedPacketService({repository,crypto});
 const registered=await evidence.registerSource(principal,source);if(registered.kind!=='committed')throw Error(JSON.stringify(registered));
 return {db,driver,ports,store,legacy,source,initialLegacy,records,payload,principal,service,repository,metrics,get now(){return now;},get fired(){return fired;},setFault:v=>fault=v,setNow:v=>now=v,
  async ingest(id){const result=await evidence.ingest(principal,{sourceId:source.sourceId,sourceRevision:'v1',recordId:id,requestedCutoffMs:null,supersedes:head});if(result.kind!=='committed')throw Error(JSON.stringify(result));head=result.value.receiptDigest;return head;},
  request(evidenceReceiptDigest,requestKey='packet-1'){return {requestKey,intentId:legacy.intent.id,attemptId:attempt.attemptId,evidenceReceiptDigest,expectedIntentRevision:db.prepare('SELECT revision FROM tx_intents WHERE id=?').get(legacy.intent.id).revision};},
  counts(){return {...db.prepare("SELECT (SELECT COUNT(*) FROM app_recorded_attempt_preparations) bindings,(SELECT COUNT(*) FROM tx_receipts) events,(SELECT COUNT(*) FROM app_command_receipts WHERE operation_kind='transactions.prepare-recorded-attempt.v1') receipts,(SELECT revision FROM tx_intents LIMIT 1) revision,(SELECT state FROM tx_intents LIMIT 1) state").get()};}
 };
}

/** Deterministic unsigned message recording for local acceptance only. */
export function packetRecording(legacy,{attemptId='synthetic-imported-1',blockByte=20,slot=60,at=legacy.now,lastValid=200}={}){
 const blockhash=Buffer.alloc(32,blockByte),program=Buffer.alloc(32,2),wire=Buffer.concat([Buffer.from([1,0,1,2]),Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a','hex'),program,blockhash,Buffer.from([1,1,0,1,1])]);
 return {version:1,network:'solana-local',attemptId,planHash:legacy.intent.planHash,genesisHash:LOCAL_REHEARSAL_GENESIS,messageBase64:wire.toString('base64'),messageHash:createHash('sha256').update(wire).digest('hex'),lookupTables:[],lifetime:{kind:'recent-blockhash',blockhash:encode58(blockhash),lastValidBlockHeight:lastValid,contextSlot:slot,observedAt:at}};
}
export function simulationRecording(packet,{height=120}={}){return {genesisHash:LOCAL_REHEARSAL_GENESIS,ok:true,messageHash:packet.messageHash,blockhash:packet.lifetime.blockhash,height,contextSlot:packet.lifetime.contextSlot,observedAt:packet.lifetime.observedAt,lookupTables:packet.lookupTables,feeUnits:'5000',outputUnits:'100',ref:'synthetic-recorded-simulation:'+packet.attemptId};}
export async function retainPacket(f,packet,{simulation=simulationRecording(packet),eventId='packet-event:'+packet.attemptId}={}){
 const sourceId='packet-recording:'+packet.attemptId,subject={kind:'transaction-attempt',id:packet.attemptId},policy={intentId:f.legacy.intent.id,attemptId:packet.attemptId,owner:f.legacy.owner,planHash:f.legacy.intent.planHash,messageHash:packet.messageHash},payload={version:1,mode:'synthetic-fixture',eventId,intentId:policy.intentId,owner:policy.owner,planHash:policy.planHash,packet,simulation,observedMs:packet.lifetime.observedAt},records=[{id:'packet',subject,contextSlot:String(packet.lifetime.contextSlot),blockTimeMs:payload.observedMs,retrievedAtMs:payload.observedMs,finality:'finalized',bytes:utf8(canonicalJson(payload))}],reader=await createRecordedReader({mode:'synthetic-fixture',chainGenesis:LOCAL_REHEARSAL_GENESIS,records,crypto:f.ports.crypto}),source={...f.source,sourceId,subject,policy,recordingDigest:reader.recordingDigest};
 const evidence=createEvidenceService({...f.ports,repository:createEvidenceRepository(f.driver,f.ports),artifactRepository:createArtifactReferenceRepository(f.driver,f.ports),store:f.store,readers:new Map([[canonicalJson([sourceId,'v1']),reader]])});
 const registered=await evidence.registerSource(f.principal,source);if(registered.kind!=='committed')throw Error(JSON.stringify(registered));
 const r=await evidence.ingest(f.principal,{sourceId,sourceRevision:'v1',recordId:'packet',requestedCutoffMs:null,supersedes:null});if(r.kind!=='committed')throw Error(JSON.stringify(r));return {...f.request(r.value.receiptDigest,'packet:'+packet.attemptId),attemptId:packet.attemptId};
}

export async function retainHeight(f,packet,blockHeight){
 const sourceId='height-for:'+packet.attemptId,subject={kind:'transaction-attempt',id:packet.attemptId},policy={intentId:f.legacy.intent.id,attemptId:packet.attemptId,owner:f.legacy.owner,planHash:f.legacy.intent.planHash,messageHash:packet.messageHash},payload={version:1,mode:'synthetic-fixture',eventId:'expiry:'+packet.attemptId,...policy,genesisHash:LOCAL_REHEARSAL_GENESIS,blockHeight,observedMs:f.now},records=[{id:'height',subject,contextSlot:String(packet.lifetime.contextSlot),blockTimeMs:f.now,retrievedAtMs:f.now,finality:'finalized',bytes:utf8(canonicalJson(payload))}],reader=await createRecordedReader({mode:'synthetic-fixture',chainGenesis:LOCAL_REHEARSAL_GENESIS,records,crypto:f.ports.crypto}),source={...f.source,sourceId,subject,policy,decoderVersion:'synthetic-transaction-height-v1',maxBytes:4096,recordingDigest:reader.recordingDigest};
 const evidence=createEvidenceService({...f.ports,repository:createEvidenceRepository(f.driver,f.ports),artifactRepository:createArtifactReferenceRepository(f.driver,f.ports),store:f.store,readers:new Map([[canonicalJson([sourceId,'v1']),reader]])});
 const registered=await evidence.registerSource(f.principal,source);if(registered.kind!=='committed')throw Error(JSON.stringify(registered));
 const r=await evidence.ingest(f.principal,{sourceId,sourceRevision:'v1',recordId:'height',requestedCutoffMs:null,supersedes:null});if(r.kind!=='committed')throw Error(JSON.stringify(r));return {...f.request(r.value.receiptDigest,'expire:'+packet.attemptId),attemptId:packet.attemptId};
}
