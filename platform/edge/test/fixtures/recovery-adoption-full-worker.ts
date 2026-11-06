import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createManifestCodec} from '../../../artifacts/manifest-codec.mjs';
import {createRecoveryV2Codec} from '../../../recovery/v2-codec.mjs';
import {createRecoveryV2Restore} from '../../../recovery/v2-restore.mjs';
import {createWorkerRecoveryDigest} from '../../../recovery/v2-worker-digest.mjs';
import {createNobleBeaconVerifier} from '../../../beacon/noble-verifier.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
// Private local test harness. Only the normal restore methods are exposed.
export default {async fetch(request:Request,env:Env&{RECOVERY_SOURCE:R2Bucket}){
 if(new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});const input=await request.json() as any;if(!['start','step','finish'].includes(input.method)||!Number.isSafeInteger(input.nowMs))return new Response('Invalid fixture request',{status:400});const base=createD1AtomicDriver(env.DB),crypto=createWebCrypto(),metrics={sql:0,objectReads:0,objectWrites:0,maxBatchBytes:0,maxParameters:0},faultsHit:string[]=[];
 const driver={...base,leaseNowSql:String(input.nowMs),async batch(statements:any[]){const m=measureBatch(statements);metrics.sql+=m.statements;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);let selected=statements;
 if(input.faults?.includes('omit-adoption-complete')&&!faultsHit.includes('omit-adoption-complete')&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-complete')){faultsHit.push('omit-adoption-complete');selected=statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-complete'));}
 const result=await base.batch(selected);if(input.faults?.includes('corrupt-stage-proof')&&!faultsHit.includes('corrupt-stage-proof'))for(let n=0;n<selected.length;n++)if(selected[n].sql.includes('i.ordinal,p.item_count,p.result_digest')&&result[n].rows[0]){faultsHit.push('corrupt-stage-proof');result[n]={...result[n],rows:result[n].rows.map((r,i)=>i===0?{...r,result_digest:'0'.repeat(64)}:r)};}
 if(input.faults?.includes('lost-final-ack')&&!faultsHit.includes('lost-final-ack')&&selected.some(s=>s.sql.startsWith("UPDATE app_recovery_state SET status='ready'"))){faultsHit.push('lost-final-ack');throw Error('Synthetic lost final ready acknowledgement');}return result;
 }},store=(bucket:R2Bucket)=>{const backing=r2ArtifactStore(bucket);return {async getVerified(identity:any){metrics.objectReads++;return backing.getVerified(identity);},async putIfAbsent(identity:any,bytes:Uint8Array){metrics.objectWrites++;return backing.putIfAbsent(identity,bytes);}};},service=createRecoveryV2Restore({driver,crypto,artifacts:store(env.MANIFESTS),sourceArtifacts:store(env.RECOVERY_SOURCE),clock:{nowMs:()=>input.nowMs},ids:{next:()=>globalThis.crypto.randomUUID()},schema:input.schema,v2Codec:createRecoveryV2Codec({crypto}),codec:createManifestCodec({crypto}),createDigest:createWorkerRecoveryDigest,beaconVerifier:createNobleBeaconVerifier()});
 const result=await service[input.method as 'start'|'step'|'finish'](input.input),state=await env.DB.prepare('SELECT mode,status,generation,write_nonce FROM app_recovery_state WHERE id=1').first(),run=await env.DB.prepare('SELECT length(CAST(checkpoint_json AS BLOB)) bytes FROM app_recovery_runs WHERE id=?').bind(input.input.pinnedDigest).first<{bytes:number}>();return Response.json({result,metrics,faultsHit,state,checkpointBytes:run?.bytes??0});
}};
