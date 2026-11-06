import recovery from './recovery-legacy-adoption-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createRecoveryV2RestoreDatabase} from '../../../recovery/v2-restore-db.mjs';
import {createRecoveryV2LegacyCurrentReconciler} from '../../../recovery/v2-reconcile-legacy-current.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:Env){
 const body=await request.clone().json() as any;if(body.method!=='current')return recovery.fetch(request,env as any);
 const base=createD1AtomicDriver(env.DB),transport={sql:0,objectReads:0,maxBatchBytes:0,maxParameters:0},metrics:any[]=[];let faulted=false;
 const driver={...base,async batch(statements:any[]){const measured=measureBatch(statements);transport.sql+=measured.statements;transport.maxBatchBytes=Math.max(transport.maxBatchBytes,measured.batchBytes);transport.maxParameters=Math.max(transport.maxParameters,measured.maxParameters);const selected=body.fault==='omit-current-proof'?statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-current')):statements;const result=await base.batch(selected);if(body.fault==='lost-current-ack'&&!faulted&&selected.some(s=>s.sql.startsWith('UPDATE app_recovery_runs'))){faulted=true;throw Error('Synthetic lost current checkpoint acknowledgement');}return result;}};
 const store=r2ArtifactStore(env.MANIFESTS),artifacts={...store,async getVerified(identity:any){transport.objectReads++;return body.fault==='missing-original'?{status:'missing' as const,identity}:store.getVerified(identity);}},repository=createRecoveryV2RestoreDatabase({driver,clock:{nowMs:()=>body.nowMs},ids:{next:()=>crypto.randomUUID()}}),helper=createRecoveryV2LegacyCurrentReconciler({driver,crypto:createWebCrypto(),artifacts,repository,onMeasure:(m:any)=>metrics.push(m)});
 return Response.json({result:await helper.step(await repository.load(body.input.pinnedDigest)),metrics,transport});
}};
