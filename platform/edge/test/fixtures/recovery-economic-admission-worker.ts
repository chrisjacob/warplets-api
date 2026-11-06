import recovery from './recovery-legacy-adoption-worker';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createRecoveryLegacyEconomicAdmissionReader} from '../../../recovery/v2-legacy-economic-admission.mjs';
export default {async fetch(request:Request,env:Env){
 const body=await request.clone().json() as any;if(body.method!=='economic-admission')return recovery.fetch(request,env as any);
 const base=createD1AtomicDriver(env.DB),driver={...base,async batch(statements:any[]){const results=await base.batch(statements);for(let n=0;n<statements.length;n++)if(statements[n].sql.includes('priorCount')){if(body.fault==='wrong-prior'&&results[n].rows[0])results[n].rows[0].walletStageCount=999;if(body.fault==='mutation')await env.DB.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();}return results;}};
 const result=await createRecoveryLegacyEconomicAdmissionReader({driver,crypto:createWebCrypto()}).read(body.admissionInput);return Response.json({result});
}};
