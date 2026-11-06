// Fixture-only pinned implementation; no public route or durable authority.
import {_SHA256} from '../../../beacon/node_modules/.pnpm/@noble+hashes@2.2.0/node_modules/@noble/hashes/sha2.js';
import type {PinnedSha256State} from '../../../collect/legacy-audit-hash.mjs';
import type {ProjectionHashAdapter} from '../../../collect/legacy-state-audit.mjs';
import {createLegacyAuditHashAdapter,LEGACY_HASH_IMPLEMENTATION_PIN} from '../../../collect/legacy-audit-hash.mjs';
import {createLegacyStateAudit} from '../../../collect/legacy-state-audit.mjs';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
export default {async fetch(request:Request,env:{DB:D1Database}){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 const input=await request.json() as any,hash=createLegacyAuditHashAdapter({createSha256:()=>new _SHA256() as unknown as PinnedSha256State,implementationPin:LEGACY_HASH_IMPLEMENTATION_PIN});let queries=0,maxReturnedBytes=0;
 const audit=createLegacyStateAudit({crypto:createWebCrypto(),hash:hash as unknown as ProjectionHashAdapter,async readRecord(id){queries++;
  const row=await env.DB.prepare('SELECT id,size,CASE WHEN size<=131072 AND length(body_base64)<=174764 THEN body_base64 ELSE NULL END body_base64 FROM app_collection_records WHERE id=?').bind(id).first<{id:string;size:number;body_base64:string|null}>();
  maxReturnedBytes=Math.max(maxReturnedBytes,new TextEncoder().encode(JSON.stringify(row)).length);if(!row||!row.body_base64)return null;return {id:row.id,size:row.size,bytes:Uint8Array.from(atob(row.body_base64),c=>c.charCodeAt(0))};
 }});
 const result=await audit.step(input);return Response.json({result,metrics:{queries,maxReturnedBytes},source:'synthetic-private-fixture'});
}};
