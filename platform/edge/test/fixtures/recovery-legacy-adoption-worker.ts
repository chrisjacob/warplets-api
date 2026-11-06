import {createWorkerRecoveryDigest} from '../../../recovery/v2-worker-digest.mjs';
// Private synthetic adopted-source recovery harness; local D1/R2 only.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createManifestCodec} from '../../../artifacts/manifest-codec.mjs';
import {createRecoveryV2Codec} from '../../../recovery/v2-codec.mjs';
import {createRecoveryV2Restore} from '../../../recovery/v2-restore.mjs';
import {createJobRepository} from '../../../jobs/repository.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
import {createNobleBeaconVerifier} from '../../../beacon/noble-verifier.mjs';
export default {async fetch(request:Request,env:Env&{RECOVERY_SOURCE:R2Bucket}){
 if(new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.json() as any;if(!Number.isSafeInteger(body.nowMs)||body.nowMs<0)return new Response('Invalid fixture clock',{status:400});
 const base=createD1AtomicDriver(env.DB),crypto=createWebCrypto(),metrics={sql:0,objectReads:0,objectWrites:0,objectBytes:0,returnedBytes:0,maxBatchBytes:0,maxParameters:0};let faulted=false;
 const driver={...base,leaseNowSql:String(body.nowMs),async batch(statements:any[]){metrics.sql+=statements.length;const m=measureBatch(statements);metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);let selected=statements;
  if(body.fault==='omit-legacy-stage-proof'&&!faulted&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption'&&String(s.values[2]).startsWith('stage:'))){faulted=true;selected=statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption'&&String(s.values[2]).startsWith('stage:')));}
  if(body.fault==='omit-check'&&!faulted&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='table-pages')){faulted=true;selected=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks'));}
  if(body.fault==='omit-final-state'&&!faulted&&statements.some(s=>s.sql.startsWith("UPDATE app_recovery_state SET status='ready'"))){faulted=true;selected=statements.filter(s=>!s.sql.startsWith("UPDATE app_recovery_state SET status='ready'"));}
  if(body.fault==='omit-fragment'&&!faulted&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_row_fragments'))){faulted=true;selected=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_row_fragments'));}
  if(body.fault==='omit-fragment-row'&&!faulted&&statements.some(s=>s.sql.includes('WITH selected AS')&&s.sql.includes('INSERT OR IGNORE INTO fair_inventories'))){faulted=true;selected=statements.filter(s=>!(s.sql.includes('WITH selected AS')&&s.sql.includes('INSERT OR IGNORE INTO fair_inventories')));}
  if(body.fault==='omit-fragment-check'&&!faulted&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='table-fragments')){faulted=true;selected=statements.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks'));}
  const results=await base.batch(selected);if(['wrong-linked-stage','wrong-current-ordinal','wrong-import-revisions'].includes(body.fault)){for(let n=0;n<selected.length;n++)if(selected[n].sql.includes('FROM app_collection_legacy_stage_imports i')&&results[n].rows[0]){if(body.fault==='wrong-linked-stage')results[n].rows[0].import_command_id='synthetic-unrelated-command';if(body.fault==='wrong-current-ordinal')results[n].rows[0].current_ordinal=999;if(body.fault==='wrong-import-revisions')results[n].rows[0].expected_revisions='{}';faulted=true;}}metrics.returnedBytes+=new TextEncoder().encode(JSON.stringify(results)).length;
  if(body.fault==='lost-final-ack'&&!faulted&&statements.some(s=>s.sql.startsWith("UPDATE app_recovery_state SET status='ready'"))){faulted=true;throw Error('Synthetic lost ready acknowledgement.');}return results;
 }};
 const store=(bucket:R2Bucket)=>{const backing=r2ArtifactStore(bucket);return {async getVerified(identity:any){metrics.objectReads++;const result=await backing.getVerified(identity);if(result.status==='verified')metrics.objectBytes+=result.bytes.length;return result;},async putIfAbsent(identity:any,bytes:Uint8Array){metrics.objectWrites++;metrics.objectBytes+=bytes.length;return backing.putIfAbsent(identity,bytes);}};};
 const ports={driver,artifacts:store(env.MANIFESTS),sourceArtifacts:store(env.RECOVERY_SOURCE),crypto,clock:{nowMs:()=>body.nowMs},ids:{next:()=>globalThis.crypto.randomUUID()},schema:body.schema,v2Codec:createRecoveryV2Codec({crypto}),codec:createManifestCodec({crypto})};
 const result=body.method==='old-lease'?await createJobRepository(driver,{...ports,principal:body.principal}).finish(body.lease,{state:'completed',result:{synthetic:true}}):await (createRecoveryV2Restore({...ports,createDigest:createWorkerRecoveryDigest,beaconVerifier:createNobleBeaconVerifier()}) as any)[body.method](body.input);
 return Response.json({result,metrics,faulted});
}};
