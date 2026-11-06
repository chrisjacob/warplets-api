import {_SHA256} from '../../../beacon/node_modules/.pnpm/@noble+hashes@2.2.0/node_modules/@noble/hashes/sha2.js';
import type {PinnedSha256State} from '../../../collect/legacy-audit-hash.mjs';
import {createLegacyAuditHashAdapter,LEGACY_HASH_IMPLEMENTATION_PIN} from '../../../collect/legacy-audit-hash.mjs';
import {createLegacyRawStateAudit} from '../../../collect/legacy-raw-state-audit.mjs';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
export default {async fetch(request:Request,env:{DB:D1Database}){if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});try{const input=await request.json() as any,hash=createLegacyAuditHashAdapter({createSha256:()=>new _SHA256() as unknown as PinnedSha256State,implementationPin:LEGACY_HASH_IMPLEMENTATION_PIN});return Response.json(await createLegacyRawStateAudit({driver:createD1AtomicDriver(env.DB),hash}).step(input));}catch(error){return Response.json({error:String(error)},{status:409});}}};
