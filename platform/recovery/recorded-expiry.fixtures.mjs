import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recordedHeightFixture} from '../storage/recorded-attempt-expiries.fixtures.mjs';
import {createRecoveryV2Capture} from './v2-capture.mjs';
import {createRecoveryV2Codec} from './v2-codec.mjs';
import {createManifestCodec} from '../artifacts/manifest-codec.mjs';
import {readInstalledRecoverySchema} from './node-schema.mjs';
export async function recordedExpiryRecoverySource(t,{capture=true}={}){
 const f=await recordedHeightFixture(t);assert.equal((await f.service.expire(f.principal,f.request(await f.ingest('expired'),'expired'))).kind,'committed');
 f.db.prepare('DELETE FROM app_evidence_heads').run();f.db.prepare('UPDATE app_operator_scopes SET enabled=0').run();f.setNow(f.now+86400000);
 const schema=await readInstalledRecoverySchema(f.ports.crypto),ports={...f,...f.ports,crypto:f.ports.crypto,schema,ids:{next:randomUUID},v2Codec:createRecoveryV2Codec(f.ports),codec:createManifestCodec(f.ports),now:f.now};
 if(!capture)return ports;
 const service=createRecoveryV2Capture({...ports,artifacts:f.store});let captured=await service.start({captureId:'synthetic-recorded-expiry-recovery',sourceCommit:'a'.repeat(40)});
 for(let n=0;n<3000&&['started','progress','replayed'].includes(captured.kind);n++)captured=await service.step({captureId:captured.captureId,expectedRevision:captured.revision});assert.equal(captured.kind,'captured',JSON.stringify(captured));return {...ports,captured};
}
export function joinedExpiry(db){return {...db.prepare('SELECT * FROM app_recorded_attempt_expiries LIMIT 1').get(),...db.prepare(`SELECT r.operation_kind,r.principal_key,r.request_key,r.request_digest,r.output_digest,r.result_ref,r.state receipt_state,r.created_ms,r.input_json,r.result_json,r.expected_revisions,r.business_key,a.state attempt_state,a.signature,(SELECT COUNT(*) FROM tx_receipts t WHERE t.attempt_id=a.id) observations FROM app_command_receipts r JOIN app_recorded_attempt_expiries o ON o.operation_id=r.operation_id JOIN tx_attempts a ON a.id=o.attempt_id LIMIT 1`).get()};}
