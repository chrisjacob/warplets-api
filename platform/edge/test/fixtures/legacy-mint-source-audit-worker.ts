import {createLegacyMintSourceAudit} from '../../../collect/legacy-mint-source-audit.mjs';
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {createWorkerRecoveryDigest} from '../../../recovery/v2-worker-digest.mjs';
import {createNobleBeaconVerifier} from '../../../beacon/noble-verifier.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).pathname!=='/__fixture'||request.method!=='POST')return new Response('Not found',{status:404});
 const {input,fault}=await request.json() as any;let objectReads=0,sql=0,changed=false;const base=createD1AtomicDriver(env.DB),driver={async batch(statements:Parameters<typeof base.batch>[0]){sql+=statements.length;return base.batch(statements);}},store=r2ArtifactStore({get:async(...args:Parameters<R2Bucket['get']>)=>{objectReads++;return env.MANIFESTS.get(...args);},put:env.MANIFESTS.put.bind(env.MANIFESTS)} as Pick<R2Bucket,'get'|'put'>),crypto=createWebCrypto();
 const artifacts={async getVerified(identity:Parameters<typeof store.getVerified>[0]){const result=await store.getVerified(identity);if(fault==='after-object'&&!changed){changed=true;await env.DB.prepare('UPDATE collect_assets SET observed_ms=observed_ms+1').run();}return result;}};
 const guardedCrypto={...crypto,async sha256(bytes:Uint8Array){const digest=await crypto.sha256(bytes);if(fault==='after-summary'&&!changed&&new TextDecoder().decode(bytes).includes('legacy-mint-source-audit-v1')){changed=true;await env.DB.prepare("UPDATE app_recovery_state SET generation='synthetic-during-summary'").run();}return digest;}};
 const result=await createLegacyMintSourceAudit({driver,crypto:guardedCrypto,artifacts,createDigest:createWorkerRecoveryDigest,beaconVerifier:createNobleBeaconVerifier()}).audit(input);return Response.json({result,physical:{sql,objectReads},source:'synthetic-private-fixture'});
}};
