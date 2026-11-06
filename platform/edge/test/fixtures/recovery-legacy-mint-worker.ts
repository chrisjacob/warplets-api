import recovery from './recovery-legacy-adoption-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createRecoveryV2RestoreDatabase} from '../../../recovery/v2-restore-db.mjs';
import {createRecoveryV2LegacyAdoptionReconciler} from '../../../recovery/v2-reconcile-legacy-adoptions.mjs';
import {createRecoveryV2LegacyMintReconciler} from '../../../recovery/v2-reconcile-legacy-mints.mjs';
import {createWorkerRecoveryDigest} from '../../../recovery/v2-worker-digest.mjs';
import {createNobleBeaconVerifier} from '../../../beacon/noble-verifier.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:Env&{RECOVERY_SOURCE:R2Bucket}){
 if(new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.clone().json() as any;if(!['mint','stages'].includes(body.method))return recovery.fetch(request,env);
 const metrics={sql:0,objectReads:0,maxBatchBytes:0,returnedBytes:0,objectBytes:0},base=createD1AtomicDriver(env.DB),crypto=createWebCrypto();let faulted=false;
 const driver={...base,leaseNowSql:String(body.nowMs),async batch(statements:any[]){metrics.sql+=statements.length;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,measureBatch(statements).batchBytes);let selected=statements;
  if(body.fault==='omit-mint-proof'&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-mint')){faulted=true;selected=statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-mint'));}
  const rows=await base.batch(selected);for(let n=0;n<selected.length;n++){const text=selected[n].sql,result=rows[n].rows;
   if(body.fault==='wrong-slot'&&text.includes('FROM vault_assets WHERE')&&result[0]){const r=result[0] as any,v=JSON.parse(r.body);v.coords='{}';r.body=JSON.stringify(v);faulted=true;}
   if(body.fault==='wrong-original-operation'&&text.includes('FROM collect_operations WHERE')&&result[0]){const r=result[0] as any,v=JSON.parse(r.body);v.proof_id='wrong';r.body=JSON.stringify(v);faulted=true;}
  }metrics.returnedBytes+=new TextEncoder().encode(JSON.stringify(rows)).length;return rows;
 }},backing=r2ArtifactStore(env.MANIFESTS),artifacts={async getVerified(identity:any){metrics.objectReads++;const r=await backing.getVerified(identity);if(r.status==='verified'){metrics.objectBytes+=r.bytes.length;if(body.fault==='corrupt-original'){faulted=true;const bytes=r.bytes.slice();bytes[0]^=1;return {...r,bytes};}}if(body.fault==='mutation'&&!faulted){faulted=true;await env.DB.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();}return r;}},repository=createRecoveryV2RestoreDatabase({driver,clock:{nowMs:()=>body.nowMs},ids:{next:()=>globalThis.crypto.randomUUID()}}),ports={driver,artifacts,crypto,repository,createDigest:createWorkerRecoveryDigest,beaconVerifier:body.fault==='bad-beacon'?{verifyShortSignature:async()=>{faulted=true;return false;}}:createNobleBeaconVerifier()};
 const measured:any[]=[],helper=body.method==='mint'?createRecoveryV2LegacyMintReconciler({...ports,onMeasure:(m:any)=>measured.push(m)}):createRecoveryV2LegacyAdoptionReconciler(ports),loaded=await repository.load(body.input.pinnedDigest),result=await helper.step(loaded);
 return Response.json({result,metrics,measured,faulted});
}};
