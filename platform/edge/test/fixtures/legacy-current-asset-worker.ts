import {createLegacyCurrentAssetAudit} from '../../../collect/legacy-current-asset-audit.mjs';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
export default {async fetch(request:Request,env:{DB:D1Database}){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 try{const input=await request.json() as {method:'read'|'closure';request:Parameters<ReturnType<typeof createLegacyCurrentAssetAudit>['read']>[0];fault?:'final-watermark'},base=createWebCrypto();let changed=false;
 const crypto={...base,async sha256(bytes:Uint8Array){const result=await base.sha256(bytes);if(input.fault==='final-watermark'&&!changed&&new TextDecoder().decode(bytes).includes(input.method==='read'?'legacy-current-asset-audit-v1':'legacy-current-asset-closure-v1')){changed=true;await env.DB.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();}return result;}};
 return Response.json(await createLegacyCurrentAssetAudit({driver:createD1AtomicDriver(env.DB),crypto})[input.method](input.request));
 }catch(error){return Response.json({error:String(error)},{status:409});}
}};
