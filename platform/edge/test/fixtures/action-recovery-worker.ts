// Private unsigned/recorded-history acceptance worker; never a production route.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createActionRecoveryReadRepository} from '../../../transactions/recovery-reads.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:Env){
 const body=await request.json() as {wallet:string;intentId:string;nowMs:number;fault?:'source-race'},base=createD1AtomicDriver(env.DB),baseCrypto=createWebCrypto(),measures:unknown[]=[];let changes=0,resultBytes=0,rows=0,raced=false;
 const driver={...base,async batch(s:Parameters<typeof base.batch>[0]){measures.push(measureBatch(s));const result=await base.batch(s);changes+=result.reduce((n,r)=>n+r.changes,0);rows+=result.reduce((n,r)=>n+r.rows.length,0);resultBytes+=new TextEncoder().encode(JSON.stringify(result)).length;return result;}};
 const crypto={...baseCrypto,async sha256(bytes:Uint8Array){const digest=await baseCrypto.sha256(bytes);if(body.fault==='source-race'&&!raced){raced=true;await env.DB.prepare('UPDATE tx_intents SET subject=subject WHERE id=?').bind(body.intentId).run();}return digest;}};
 const result=await createActionRecoveryReadRepository(driver,{crypto,clock:{nowMs:()=>body.nowMs}}).readRecovery({kind:'wallet',wallet:body.wallet},{intentId:body.intentId});return Response.json({result,measurement:{measures,changes,resultBytes,rows},raced});
}};
