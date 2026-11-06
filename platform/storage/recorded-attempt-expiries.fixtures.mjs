import {randomUUID} from 'node:crypto';
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
import {RECORDED_HEIGHT_DECODER} from '../transactions/recorded-height-evidence.mjs';
import {LOCAL_REHEARSAL_GENESIS} from '../transactions/recorded-outcome-evidence.mjs';
import {createRecordedHeightService} from '../transactions/recorded-height-service.mjs';
import {createRecordedAttemptExpiryRepository} from './recorded-attempt-expiries.mjs';
export const RECORDED_HEIGHT_TEST_PRINCIPAL={kind:'operator',id:'synthetic-height-recorder'};
/** Actual retained local history; fixed synthetic signature labels, never signing. */
export async function recordedHeightFixture(t,{state='awaiting_signature'}={}){
 const db=openDatabase();t.after(()=>db.close());
 const legacy=await recoveryReadFixture(db,{state}),initialLegacy=legacy.dump(),crypto=createNodeCrypto(),store=memoryArtifacts(),attempt=legacy.packets.at(-1),principal=RECORDED_HEIGHT_TEST_PRINCIPAL;let now=legacy.now+100,head=null,fault=null,fired=0;
 db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(principal.id,'evidence-ingest');db.function('synthetic_height_clock',()=>now);
 const raw={...createNodeAtomicDriver(db),leaseNowSql:'synthetic_height_clock()'},metrics={sqlStatements:0};
 const driver={...raw,async batch(statements){metrics.sqlStatements+=statements.length;const commit=statements.some(s=>s.sql.startsWith('INSERT INTO app_recorded_attempt_expiries'));
  if(commit){if(fault?.startsWith('omit-')){const targets={'omit-binding':'INSERT INTO app_recorded_attempt_expiries','omit-intent':'UPDATE tx_intents','omit-attempt':'UPDATE tx_attempts'};statements=statements.filter(s=>!s.sql.startsWith(targets[fault]));fired++;}
   if(fault==='alter-height'){statements=statements.map(s=>s.sql.startsWith('INSERT INTO app_recorded_attempt_expiries')?{...s,values:s.values.map((v,index)=>index===7?999:v)}:s);fired++;}
   if(fault==='clock'){now+=30001;fired++;}
   if(fault==='scope'){db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(principal.id);fired++;}
   if(fault==='head'){db.prepare('DELETE FROM app_evidence_heads').run();fired++;}
  }const out=await raw.batch(statements);if(commit&&fault==='lose'){fired++;throw Error('Synthetic committed outcome response lost');}return out;}};
 const policy={intentId:legacy.intent.id,attemptId:attempt.attemptId,owner:legacy.owner,planHash:legacy.intent.planHash,messageHash:attempt.messageHash},subject={kind:'transaction-attempt',id:attempt.attemptId};
 const variants=[['boundary',attempt.lifetime.lastValidBlockHeight],['expired',attempt.lifetime.lastValidBlockHeight+1],['later',attempt.lifetime.lastValidBlockHeight+2]];
 const records=variants.map(([id,blockHeight],index)=>{const payload={version:1,mode:'synthetic-fixture',eventId:'height-'+id,...policy,blockHeight,genesisHash:LOCAL_REHEARSAL_GENESIS,observedMs:legacy.now+index+1};return {id,subject,contextSlot:'50',blockTimeMs:payload.observedMs,retrievedAtMs:payload.observedMs,finality:'finalized',bytes:utf8(canonicalJson(payload))};});
 const reader=await createRecordedReader({mode:'synthetic-fixture',chainGenesis:LOCAL_REHEARSAL_GENESIS,records,crypto}),source={version:1,sourceId:'synthetic-height:'+legacy.intent.id,sourceRevision:'v1',mode:'synthetic-fixture',chainGenesis:LOCAL_REHEARSAL_GENESIS,decoderVersion:RECORDED_HEIGHT_DECODER,subject,policy,recordingDigest:reader.recordingDigest,maxBytes:4096,maxAgeMs:30000},ports={crypto,ids:{next:randomUUID},clock:{nowMs:()=>now}};
 const evidence=createEvidenceService({...ports,repository:createEvidenceRepository(driver,ports),artifactRepository:createArtifactReferenceRepository(driver,ports),store,readers:new Map([[canonicalJson([source.sourceId,source.sourceRevision]),reader]])}),repository=createRecordedAttemptExpiryRepository(driver,{...ports,store}),service=createRecordedHeightService({repository,crypto});
 const registered=await evidence.registerSource(principal,source);if(registered.kind!=='committed')throw Error(JSON.stringify(registered));
 return {db,driver,ports,store,legacy,source,initialLegacy,records,principal,service,repository,metrics,get now(){return now;},get fired(){return fired;},setFault:v=>fault=v,setNow:v=>now=v,
  async ingest(id){const result=await evidence.ingest(principal,{sourceId:source.sourceId,sourceRevision:'v1',recordId:id,requestedCutoffMs:null,supersedes:head});if(result.kind!=='committed')throw Error(JSON.stringify(result));head=result.value.receiptDigest;return head;},
  request(evidenceReceiptDigest,requestKey='height-1'){return {requestKey,intentId:legacy.intent.id,attemptId:attempt.attemptId,evidenceReceiptDigest,expectedIntentRevision:db.prepare('SELECT revision FROM tx_intents WHERE id=?').get(legacy.intent.id).revision};},
  counts(){return {...db.prepare("SELECT (SELECT COUNT(*) FROM app_recorded_attempt_expiries) bindings,(SELECT COUNT(*) FROM tx_receipts) events,(SELECT COUNT(*) FROM app_command_receipts WHERE operation_kind='transactions.expire-recorded-attempt.v1') receipts,(SELECT revision FROM tx_intents LIMIT 1) revision,(SELECT state FROM tx_intents LIMIT 1) state").get()};}
 };
}
