// Private read-planning conformance only; no recovery authority or public route.
import {planRecoveryFragmentProbe,materializeRecoveryFragmentProbe,planRecoveryFragmentChunk,materializeRecoveryFragmentChunk} from '../../../recovery/v2-fragment-planning.mjs';
import {createRecoveryV2FragmentCodec} from '../../../recovery/v2-fragments.mjs';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});const body=await request.json() as any,codec=createRecoveryV2FragmentCodec({crypto:createWebCrypto()});
 const plan=body.method==='probe'?planRecoveryFragmentProbe(body.table,body.input):planRecoveryFragmentChunk(body.header,body.index),rows=(await env.DB.prepare(plan.statement.sql).bind(...plan.statement.values).all()).results;
 if(body.method==='probe')return Response.json({value:materializeRecoveryFragmentProbe(plan as any,rows),metrics:{...measureBatch([plan.statement]),resultBytes:new TextEncoder().encode(JSON.stringify(rows)).length}});
 const piece=materializeRecoveryFragmentChunk(plan as any,rows),chunk=await codec.encodeChunk(piece.text);return Response.json({piece,identity:chunk.identity,metrics:{...measureBatch([plan.statement]),resultBytes:new TextEncoder().encode(JSON.stringify(rows)).length}});
}};
