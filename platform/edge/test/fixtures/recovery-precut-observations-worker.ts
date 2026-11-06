import recovery from './recovery-legacy-adoption-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createRecoveryLegacyPrecutObservations} from '../../../recovery/v2-legacy-precut-observations.mjs';
import {createRetainedCollectionObservationVerifier} from '../../../recovery/v2-legacy-current-observation.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:Env&{RECOVERY_SOURCE:R2Bucket}){
 if(new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});const body=await request.clone().json() as any;if(!['precut-start','precut-step','postcut'].includes(body.method))return recovery.fetch(request,env);
 const base=createD1AtomicDriver(env.DB),crypto=createWebCrypto(),metrics={sql:0,objectReads:0,maxBatchBytes:0};let faulted=false;
 const driver={...base,async batch(statements:any[]){metrics.sql+=statements.length;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,measureBatch(statements).batchBytes);const result=await base.batch(statements);for(let n=0;n<statements.length;n++){
  if(body.fault==='missing-proof'&&statements[n].sql.includes("phase='legacy-adoption-mint'")){result[n]={...result[n],rows:[]};faulted=true;}
  if(body.fault==='wrong-time'&&statements[n].sql.startsWith('SELECT b.source_id,b.event_kind'))for(const r of result[n].rows as any[]){r.created_ms=body.nowMs+10000;faulted=true;}
 }return result;}},backing=r2ArtifactStore(env.MANIFESTS),artifacts={...backing,async getVerified(identity:any){metrics.objectReads++;if(body.fault==='missing-object'){faulted=true;return {status:'missing' as const,identity};}return backing.getVerified(identity);}},helper=createRecoveryLegacyPrecutObservations({driver,crypto,artifacts});
 const result=body.method==='postcut'?await createRetainedCollectionObservationVerifier({driver,crypto,artifacts}).replay(body.query):await helper[body.method==='precut-start'?'start':'step'](body.query);return Response.json({result,metrics,faulted});
}};
