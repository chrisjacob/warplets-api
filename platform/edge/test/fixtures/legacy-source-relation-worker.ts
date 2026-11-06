// Private synthetic acceptance only. No public audit route or write authority.
import {createLegacySourceRelationAudit} from '../../../collect/legacy-source-relation.mjs';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
export default {async fetch(request:Request,env:{DB:D1Database}){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 const body=await request.json() as any,base=createD1AtomicDriver(env.DB),cryptoPort=createWebCrypto();let altered=false;let failure:string|undefined;
 const service=createLegacySourceRelationAudit({driver:{...base,async batch(statements){if(body.fault==='read')throw Error('Synthetic unavailable read');try{return await base.batch(statements);}catch(error){failure=String(error);throw error;}}},crypto:{...cryptoPort,async sha256(bytes){const digest=await cryptoPort.sha256(bytes);if(body.fault==='after-hash'&&!altered){altered=true;await env.DB.prepare("UPDATE collect_inventories SET state=state||' ' WHERE id=?").bind(body.input.inventoryId).run();}return digest;}}});
 const result=await service.step(body.input);return Response.json(failure?{...result,fixtureFailure:failure}:result);
}};
