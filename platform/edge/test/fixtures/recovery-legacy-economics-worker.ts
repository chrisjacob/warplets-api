import prior from './recovery-legacy-mint-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createRecoveryV2RestoreDatabase} from '../../../recovery/v2-restore-db.mjs';
import {createRecoveryV2LegacyEconomicsReconciler} from '../../../recovery/v2-reconcile-legacy-economics.mjs';
import {createRecoveryV2LegacyCurrentReconciler} from '../../../recovery/v2-reconcile-legacy-current.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:Env&{RECOVERY_SOURCE:R2Bucket}){
 const body=await request.clone().json() as any;if(!['economic','current','phase'].includes(body.method))return prior.fetch(request,env);
 const metrics={sql:0,objects:0,maxBatchBytes:0},base=createD1AtomicDriver(env.DB),driver={...base,async batch(statements:any[]){metrics.sql+=statements.length;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,measureBatch(statements).batchBytes);const selected=body.fault==='omit-economic-proof'?statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-economics')):statements;return base.batch(selected);}},backing=r2ArtifactStore(env.MANIFESTS),artifacts={async getVerified(identity:any){metrics.objects++;return backing.getVerified(identity);}},repository=createRecoveryV2RestoreDatabase({driver,clock:{nowMs:()=>body.nowMs},ids:{next:()=>crypto.randomUUID()}}),loaded=await repository.load(body.input.pinnedDigest),measured:any[]=[],ports={driver,crypto:createWebCrypto(),artifacts,repository,onMeasure:(m:any)=>{measured.push(m);}};
 let result;if(body.method==='phase'){if(!['reconcile-legacy-adoption-mints','reconcile-legacy-adoption-economics'].includes(body.phase))return new Response('Invalid phase',{status:400});result=await repository.advance(loaded,{delta:{phase:body.phase},targetWatermark:JSON.parse(loaded.run.checkpoint_json).targetWatermark});}else result=await (body.method==='economic'?createRecoveryV2LegacyEconomicsReconciler(ports):createRecoveryV2LegacyCurrentReconciler(ports)).step(loaded);
 return Response.json({result,metrics,measured});
}};
