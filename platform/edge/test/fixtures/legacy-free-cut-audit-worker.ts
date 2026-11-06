import {_SHA256} from '../../../beacon/node_modules/.pnpm/@noble+hashes@2.2.0/node_modules/@noble/hashes/sha2.js';
import type {PinnedSha256State} from '../../../collect/legacy-audit-hash.mjs';
import type {ProjectionHashAdapter} from '../../../collect/legacy-state-audit.mjs';
import {createLegacyAuditHashAdapter,LEGACY_HASH_IMPLEMENTATION_PIN} from '../../../collect/legacy-audit-hash.mjs';
import {createLegacyFreeCutAudit} from '../../../collect/legacy-free-cut-audit.mjs';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {canonicalJson} from '../../../security/canonical.mjs';
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});const body=await request.json() as any,input=body.input,metrics={sql:0,objectReads:0,maxReturnedBytes:0};
 const measured=(value:unknown)=>{metrics.maxReturnedBytes=Math.max(metrics.maxReturnedBytes,new TextEncoder().encode(JSON.stringify(value)).length);return value;};
 metrics.sql++;const snapshot=await env.DB.prepare('SELECT * FROM collect_snapshots WHERE id=?').bind(input.snapshot.id).first();measured(snapshot);if(!snapshot||canonicalJson(snapshot)!==canonicalJson(input.snapshot))return Response.json({fixtureError:'synthetic-retained-snapshot-binding'}, {status:409});
 const hash=createLegacyAuditHashAdapter({createSha256:()=>new _SHA256() as unknown as PinnedSha256State,implementationPin:LEGACY_HASH_IMPLEMENTATION_PIN}),service=createLegacyFreeCutAudit({crypto:createWebCrypto(),hash:hash as unknown as ProjectionHashAdapter,
  async readRecord(id){metrics.sql++;const row=await env.DB.prepare('SELECT id,size,CASE WHEN size<=131072 AND length(body_base64)<=174764 THEN body_base64 ELSE NULL END body_base64 FROM app_collection_records WHERE id=?').bind(id).first<{id:string;size:number;body_base64:string|null}>();measured(row);if(row){if(!row.body_base64)return null;return {id:row.id,size:row.size,bytes:Uint8Array.from(atob(row.body_base64),c=>c.charCodeAt(0))};}metrics.objectReads++;const object=await env.MANIFESTS.get('synthetic-legacy-free-cut/'+id);if(!object||object.size>65536)return null;return {id,size:object.size,bytes:new Uint8Array(await object.arrayBuffer())};},
  async lookupMembership({listId,wallets}){metrics.sql++;const result=await env.DB.prepare(`SELECT e.value wallet,CAST(p.key AS INTEGER) pageIndex,CAST(e.key AS INTEGER) offset FROM app_collection_list_seals l JOIN json_each(l.page_ids_json) p JOIN app_collection_eligibility_pages i ON i.record_id=p.value JOIN json_each(i.entries_json) e WHERE l.id=? AND e.value IN(SELECT value FROM json_each(?)) LIMIT 33`).bind(listId,JSON.stringify(wallets)).all<{wallet:string;pageIndex:number;offset:number}>();measured(result.results);const rows=body.fault==='wrong-locator'?result.results.map(r=>({...r,offset:(r.offset+1)%100})):result.results;return {listId,rows};}
 });const result=await service.step(input);return Response.json({result,metrics,source:'synthetic-private-fixture'});
}};
