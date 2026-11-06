import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recordedPacketFixture,packetRecording,simulationRecording,retainPacket,retainHeight} from '../storage/recorded-attempt-preparations.fixtures.mjs';
import {createRecordedAttemptExpiryRepository} from '../storage/recorded-attempt-expiries.mjs';
import {createRecordedHeightService} from '../transactions/recorded-height-service.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
export async function recordedPreparationRecoverySource(t,{capture=true,expireLast=true}={}){
 const f=await recordedPacketFixture(t),first=f.payload.packet;assert.equal((await f.service.prepare(f.principal,f.request(await f.ingest('packet'),'first'))).kind,'committed');
 const expiry=createRecordedHeightService({repository:createRecordedAttemptExpiryRepository(f.driver,{...f.ports,store:f.store}),crypto:f.ports.crypto});
 f.setNow(f.now+100);assert.equal((await expiry.expire(f.principal,await retainHeight(f,first,first.lifetime.lastValidBlockHeight+1))).kind,'committed');
 f.setNow(f.now+100);const second=packetRecording(f.legacy,{attemptId:'synthetic-imported-2',blockByte:21,slot:61,at:f.now,lastValid:300});
 assert.equal((await f.service.prepare(f.principal,await retainPacket(f,second,{simulation:simulationRecording(second,{height:201})}))).kind,'committed');
 if(expireLast){f.setNow(f.now+100);assert.equal((await expiry.expire(f.principal,await retainHeight(f,second,301))).kind,'committed');}
 f.db.prepare('DELETE FROM app_evidence_heads').run();f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();f.setNow(f.now+86400000);
 const schema=await readInstalledRecoverySchema(f.ports.crypto),ports={...f,...f.ports,crypto:f.ports.crypto,schema,ids:{next:randomUUID},v2Codec:createRecoveryV2Codec(f.ports),codec:createManifestCodec(f.ports),now:f.now};
 if(!capture)return ports;
 const service=createRecoveryV2Capture({...ports,artifacts:f.store});let captured=await service.start({captureId:'synthetic-recorded-preparation-recovery',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<3000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await service.step({captureId:captured.captureId,expectedRevision:captured.revision});assert.equal(captured.kind,'captured',JSON.stringify(captured));return {...ports,captured};
}
export function joinedPreparation(db,index=1){return {...db.prepare('SELECT o.* FROM app_recorded_attempt_preparations o JOIN tx_attempts a ON a.id=o.attempt_id WHERE a.attempt_index=?').get(index),...db.prepare(`SELECT r.operation_kind,r.principal_key,r.request_key,r.request_digest,r.output_digest,r.result_ref,r.state receipt_state,r.created_ms receipt_created_ms,r.input_json,r.result_json,r.expected_revisions,r.business_key,a.state attempt_state,a.signature,a.packet,a.simulation_ref,i.plan FROM app_command_receipts r JOIN app_recorded_attempt_preparations o ON o.operation_id=r.operation_id JOIN tx_attempts a ON a.id=o.attempt_id JOIN tx_intents i ON i.id=o.intent_id WHERE a.attempt_index=?`).get(index)};}
