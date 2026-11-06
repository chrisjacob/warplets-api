// Private local acceptance only; optional pinned dependency is fixture-only.
import {_SHA256} from '../../../beacon/node_modules/.pnpm/@noble+hashes@2.2.0/node_modules/@noble/hashes/sha2.js';
import type {PinnedSha256State} from '../../../collect/legacy-audit-hash.mjs';
import {createLegacyAuditHashAdapter,LEGACY_HASH_IMPLEMENTATION_PIN} from '../../../collect/legacy-audit-hash.mjs';
import {createLegacyAuditRepository} from '../../../collect/legacy-audit-repository.mjs';
import {createLegacyRelationRepository} from '../../../collect/legacy-relation-repository.mjs';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:{DB:D1Database}){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 try{const body=await request.json() as any,base=createD1AtomicDriver(env.DB),metrics={sql:0,batches:0,maxBatchBytes:0,maxReturnedBytes:0,returnedBytes:0,workingBytes:0};let faulted=false;
  const driver={...base,async batch(statements:any[]){metrics.sql+=statements.length;metrics.batches++;metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,measureBatch(statements).batchBytes);const writing=statements.some(s=>s.sql.startsWith('UPDATE app_collection_legacy_relations'));
   if(writing&&!faulted){faulted=true;if(body.fault==='omit')return [{rows:[],changes:0}];if(body.fault==='source')await env.DB.prepare("UPDATE collect_inventories SET state=state||' '").run();if(body.fault==='scope')await env.DB.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').bind(body.principal.id).run();if(body.fault==='schema')await env.DB.prepare('DROP TRIGGER recovery_watermark_collect_inventories_update').run();if(body.fault==='generation')await env.DB.prepare("UPDATE app_recovery_state SET generation='synthetic-replaced'").run();if(body.fault==='final-null')statements=statements.map(s=>s.sql.startsWith('UPDATE app_collection_legacy_relations')&&s.values[0]==='ready'?{...s,values:s.values.map((v:any,i:number)=>i===2?null:v)}:s);}
   const result=await base.batch(statements),bytes=new TextEncoder().encode(JSON.stringify(result)).length;metrics.maxReturnedBytes=Math.max(metrics.maxReturnedBytes,bytes);metrics.returnedBytes+=bytes;if(writing&&body.fault==='lost')throw Error('Synthetic lost durable relation acknowledgement');return writing&&body.fault==='zero-changes'?result.map(r=>({...r,changes:0})):result;
  }},ports={driver,crypto:createWebCrypto(),clock:{nowMs:()=>1800000000000},ids:{next:()=>body.nonce??crypto.randomUUID()},onMeasure:(m:{workingBytes:number})=>{metrics.workingBytes=Math.max(metrics.workingBytes,m.workingBytes);}},parent=createLegacyAuditRepository({...ports,schema:body.schema,createHashAdapter:()=>createLegacyAuditHashAdapter({createSha256:()=>new _SHA256() as unknown as PinnedSha256State,implementationPin:LEGACY_HASH_IMPLEMENTATION_PIN})}),relation=createLegacyRelationRepository(ports),service=body.method.startsWith('parent-')?parent:relation,method=body.method.replace('parent-','') as 'start'|'step',result=await (service[method] as any)(body.principal,body.input);return Response.json({result,metrics,source:'synthetic-private-fixture'});
 }catch(error){return Response.json({error:String(error)},{status:409});}
}};
