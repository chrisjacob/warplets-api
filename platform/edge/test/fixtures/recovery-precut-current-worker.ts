import recovery from './recovery-legacy-adoption-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createRecoveryV2RestoreDatabase} from '../../../recovery/v2-restore-db.mjs';
import {createRecoveryV2LegacyCurrentReconciler} from '../../../recovery/v2-reconcile-legacy-current.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:Env&{RECOVERY_SOURCE:R2Bucket}){
 if(new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});const body=await request.clone().json() as any;if(body.method!=='current')return recovery.fetch(request,env);
 const base=createD1AtomicDriver(env.DB),metrics={sql:0,objectReads:0,maxBatchBytes:0},crypto=createWebCrypto();let faulted=false;const driver={...base,async batch(statements:any[]){metrics.sql+=statements.length;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,measureBatch(statements).batchBytes);let selected=statements;
  if(body.fault==='omit-clear'&&statements.some(s=>s.sql.startsWith('UPDATE app_recovery_state SET write_nonce=NULL'))){selected=statements.filter(s=>!s.sql.startsWith('UPDATE app_recovery_state SET write_nonce=NULL'));faulted=true;}
  if(body.fault==='omit-proof'&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-current')){selected=statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-current'));faulted=true;}
  const result=await base.batch(selected);if(body.fault==='lost-ack'&&!faulted&&statements.some(s=>s.sql.startsWith('UPDATE app_recovery_runs SET checkpoint_json='))){faulted=true;throw Error('Synthetic lost D1 pre-cut checkpoint acknowledgement.');}return result;
 }},store=r2ArtifactStore(env.MANIFESTS),artifacts={...store,async getVerified(identity:any){metrics.objectReads++;return store.getVerified(identity);}},repository=createRecoveryV2RestoreDatabase({driver,clock:{nowMs:()=>body.nowMs},ids:{next:()=>globalThis.crypto.randomUUID()}}),measured:any[]=[],helper=createRecoveryV2LegacyCurrentReconciler({driver,crypto,artifacts,repository,onMeasure:(m:any)=>measured.push(m)}),result=await helper.step(await repository.load(body.input.pinnedDigest));return Response.json({result,metrics,measured,faulted});
}};
