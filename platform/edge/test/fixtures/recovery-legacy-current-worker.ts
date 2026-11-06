import recovery from './recovery-legacy-adoption-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createRecoveryV2RestoreDatabase} from '../../../recovery/v2-restore-db.mjs';
import {createRecoveryV2LegacyCurrentReconciler} from '../../../recovery/v2-reconcile-legacy-current.mjs';
export default {async fetch(request:Request,env:Env){
 const body=await request.clone().json() as any;
 if(body.method!=='current')return recovery.fetch(request,env as any);
 const base=createD1AtomicDriver(env.DB),driver={...base,async batch(statements:any[]){return base.batch(body.fault==='omit-current-proof'?statements.filter(s=>!(s.sql.startsWith('INSERT INTO app_recovery_reconcile_checks')&&s.values[1]==='legacy-adoption-current')):statements);}},metrics:any[]=[];
 const repository=createRecoveryV2RestoreDatabase({driver,clock:{nowMs:()=>body.nowMs},ids:{next:()=>crypto.randomUUID()}}),helper=createRecoveryV2LegacyCurrentReconciler({driver,crypto:createWebCrypto(),repository,onMeasure:(m:any)=>metrics.push(m)});
 return Response.json({result:await helper.step(await repository.load(body.input.pinnedDigest)),metrics});
}};
