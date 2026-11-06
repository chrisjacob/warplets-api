// Private local acceptance entry point, never mounted by the production Worker.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
import {createOperationalMetrics} from '../../../observability/metrics.mjs';
import {createOperationalEvent} from '../../../observability/events.mjs';
import {readinessFromMetrics} from '../../../operations/readiness.mjs';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
export default {async fetch(request:Request,env:Env){
 const body=await request.json() as {nowMs:number},base=createD1AtomicDriver(env.DB),measures:unknown[]=[];let rows=0,bytes=0,changes=0;
 const driver={...base,async batch(s:Parameters<typeof base.batch>[0]){measures.push(measureBatch(s));const result=await base.batch(s);rows+=result.reduce((n,r)=>n+r.rows.length,0);bytes+=new TextEncoder().encode(JSON.stringify(result)).length;changes+=result.reduce((n,r)=>n+r.changes,0);return result;}};
 const metrics=await createOperationalMetrics({driver,clock:{nowMs:()=>body.nowMs}}).read(),readiness=readinessFromMetrics(metrics),event=await createOperationalEvent({runtime:'workerd',kind:'job',outcome:'pending',reason:'dependency',jobId:'PRIVATE-D1-CANARY',cookie:'PRIVATE-D1-CANARY',rowsRead:rows},{crypto:createWebCrypto(),clock:{nowMs:()=>body.nowMs}});
 return Response.json({metrics,readiness,event,measurement:{batches:measures.length,measures,rows,bytes,changes}});
}};
