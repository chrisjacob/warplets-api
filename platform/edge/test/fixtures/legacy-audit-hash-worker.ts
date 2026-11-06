// Fixture-only pinned transitive import. No application dependency/composition.
import {_SHA256} from '../../../beacon/node_modules/.pnpm/@noble+hashes@2.2.0/node_modules/@noble/hashes/sha2.js';
import type {PinnedSha256State} from '../../../collect/legacy-audit-hash.mjs';
import {createLegacyAuditHashAdapter,LEGACY_HASH_IMPLEMENTATION_PIN} from '../../../collect/legacy-audit-hash.mjs';
// The pinned adapter intentionally validates version-specific protected fields.
const adapter=createLegacyAuditHashAdapter({createSha256:()=>new _SHA256() as unknown as PinnedSha256State,implementationPin:LEGACY_HASH_IMPLEMENTATION_PIN});
export default {async fetch(request:Request){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 const body=await request.json() as any;
 try{if(body.method==='initial')return Response.json({state:adapter.initial()});if(body.method==='finish')return Response.json({digest:adapter.finish(body.state)});
  if(body.method!=='step'||!Number.isSafeInteger(body.width)||body.width<1||body.width>65536||!Number.isSafeInteger(body.offset)||body.offset<0||body.offset!==body.state.bytes)return new Response('Invalid synthetic chunk',{status:400});
  const bytes=Uint8Array.from({length:body.width},(_,n)=>((body.offset+n)*73+19)&255),state=adapter.advance(body.state,bytes);return Response.json({state,source:'synthetic-generated-bytes',chunkBytes:bytes.length});
 }catch(error){return Response.json({error:String(error)},{status:409});}
}};
