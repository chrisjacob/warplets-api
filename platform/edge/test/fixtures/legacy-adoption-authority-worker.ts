import {createLegacyAdoptionAuthorityReader} from '../../../collect/legacy-adoption-authority.mjs';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
export default {async fetch(request:Request,env:{DB:D1Database}){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 try{const input=await request.json() as {request:Parameters<ReturnType<typeof createLegacyAdoptionAuthorityReader>['read']>[0];fault?:string},base=createWebCrypto();let changed=false;
 const crypto={...base,async sha256(bytes:Uint8Array){const result=await base.sha256(bytes);if(input.fault==='final-watermark'&&!changed){changed=true;await env.DB.prepare('UPDATE app_recovery_watermark SET revision=revision+1 WHERE id=1').run();}return result;}};
 return Response.json(await createLegacyAdoptionAuthorityReader({driver:createD1AtomicDriver(env.DB),crypto}).read(input.request));
 }catch(error){return Response.json({error:String(error)},{status:409});}
}};
