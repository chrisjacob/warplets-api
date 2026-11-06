import {createLegacyMintSource} from '../../../collect/legacy-mint-source.mjs';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
export default {async fetch(request:Request,env:{DB:D1Database}){if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});try{const input=await request.json() as Parameters<ReturnType<typeof createLegacyMintSource>['read']>[0];return Response.json(await createLegacyMintSource({driver:createD1AtomicDriver(env.DB),crypto:createWebCrypto()}).read(input));}catch(error){return Response.json({error:String(error)},{status:409});}}};
