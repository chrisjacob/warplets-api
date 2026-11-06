import recovery from './recovery-legacy-adoption-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createRecoveryLegacyEconomicStageReader} from '../../../recovery/v2-legacy-economic-stage.mjs';
export default {async fetch(request:Request,env:Env){
 const body=await request.clone().json() as any;if(body.method!=='economic-stage')return recovery.fetch(request,env as any);
 const base=createD1AtomicDriver(env.DB),driver={...base,async batch(statements:any[]){const results=await base.batch(statements);if(body.fault==='wrong-proof')for(let n=0;n<statements.length;n++)if(statements[n].sql.includes('FROM app_recovery_reconcile_checks')&&results[n].rows[0])results[n].rows[0].result_digest='a'.repeat(64);return results;}};
 const result=await createRecoveryLegacyEconomicStageReader({driver,crypto:createWebCrypto(),artifacts:r2ArtifactStore(env.MANIFESTS)}).read(body.stageInput);
 return Response.json({result});
}};
