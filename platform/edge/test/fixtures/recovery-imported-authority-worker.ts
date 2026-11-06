import recovery from './recovery-legacy-adoption-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createRecoveryV2RestoreDatabase} from '../../../recovery/v2-restore-db.mjs';
import {createRecoveryV2CollectionReconciler} from '../../../recovery/v2-reconcile-collections.mjs';
import {verifyRecoveryImportedAuthority} from '../../../recovery/v2-reconcile-imported-authority.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:Env&{RECOVERY_SOURCE:R2Bucket}){
 if(new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});const body=await request.clone().json() as any;if(!['collection','authority-check'].includes(body.method))return recovery.fetch(request,env);
 const metrics={sql:0,objectReads:0,maxBatchBytes:0,returnedBytes:0,objectBytes:0},base=createD1AtomicDriver(env.DB),crypto=createWebCrypto();let faulted=false;
 const driver={...base,leaseNowSql:String(body.nowMs),async batch(statements:any[]){metrics.sql+=statements.length;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,measureBatch(statements).batchBytes);let selected=statements;
  if(body.fault==='omit-authority-proof'&&statements.some(s=>s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='collection'&&String(s.values[2]).startsWith('authority:'))){faulted=true;selected=statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='collection'&&String(s.values[2]).startsWith('authority:')));}
  const result=await base.batch(selected);for(let n=0;n<selected.length;n++){const text=selected[n].sql,rows=result[n].rows as any[];if(body.fault==='missing-completion'&&text.includes("phase='legacy-adoption-complete'")){result[n]={...result[n],rows:[]};faulted=true;}if(body.fault==='bad-prefix'&&text.includes('WITH historical AS')&&rows[0]){rows[0].invalid_prefix++;faulted=true;}if(body.fault==='duplicate-slot'&&text.includes('COUNT(DISTINCT slot_key)')&&rows[0]){rows[0].unique_slots--;faulted=true;}}
  for(let n=0;n<selected.length;n++)if(body.fault==='wrong-time'&&selected[n].sql.includes('COUNT(DISTINCT ordinal) ordinals')&&result[n].rows[0]){(result[n].rows[0] as any).invalid_times++;faulted=true;}metrics.returnedBytes+=new TextEncoder().encode(JSON.stringify(result)).length;return result;
 }},backing=r2ArtifactStore(env.MANIFESTS),artifacts={async getVerified(identity:any){metrics.objectReads++;const r=await backing.getVerified(identity);if(r.status==='verified')metrics.objectBytes+=r.bytes.length;return r;}},repository=createRecoveryV2RestoreDatabase({driver,clock:{nowMs:()=>body.nowMs},ids:{next:()=>globalThis.crypto.randomUUID()}}),loaded=await repository.load(body.input.pinnedDigest),c=JSON.parse(loaded.run!.checkpoint_json),measured:any[]=[];let result;
 try{if(body.method==='authority-check'){const authority=await env.DB.prepare('SELECT a.*,h.revision header_revision,h.kind,h.tranche,h.season_start,h.origin_digest FROM app_collection_authorities a JOIN collect_inventories h ON h.id=a.inventory_id').first();result=await verifyRecoveryImportedAuthority({loaded,c,authority},{driver,crypto,onMeasure:(m:any)=>measured.push(m)});}else result=await createRecoveryV2CollectionReconciler({driver,artifacts,crypto,repository,beaconVerifier:undefined}).step(loaded,c);}catch(error){result=await repository.hold(loaded,'recovery-reconciliation-invalid:'+(error as Error).message);}
 return Response.json({result,metrics,measured,faulted});
}};
