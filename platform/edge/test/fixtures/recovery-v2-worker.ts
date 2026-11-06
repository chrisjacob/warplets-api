// Private local acceptance surface only. No production recovery capability.
import {createD1AtomicDriver} from '../../../storage/d1/atomic-driver';
import {createWebCrypto} from '../../../security/web-crypto.mjs';
import {r2ArtifactStore} from '../../../artifacts/r2';
import {createManifestCodec} from '../../../artifacts/manifest-codec.mjs';
import {createRecoveryV2Codec} from '../../../recovery/v2-codec.mjs';
import {createRecoveryV2CaptureSource} from '../../../recovery/v2-capture-source.mjs';
import {createRecoveryV2ReferenceCapture} from '../../../recovery/v2-capture-references.mjs';
import {createRecoveryV2Capture} from '../../../recovery/v2-capture.mjs';
import {measureBatch} from '../../../storage/atomic-driver.mjs';
export default {async fetch(request:Request,env:Env){
 if(new URL(request.url).pathname!=='/__fixture')return new Response('Not found',{status:404});
 const body=await request.json() as any,base=createD1AtomicDriver(env.DB),backing=r2ArtifactStore(env.MANIFESTS),crypto=createWebCrypto();
 const metrics={sql:0,reads:0,writes:0,maxBatchBytes:0,maxParameters:0,returnedBytes:0,objectBytes:0};let faulted=false;
 const driver={...base,async batch(input:any[]){metrics.sql+=input.length;const m=measureBatch(input);metrics.maxBatchBytes=Math.max(metrics.maxBatchBytes,m.batchBytes);metrics.maxParameters=Math.max(metrics.maxParameters,m.maxParameters);let statements=input;
  if(body.fault==='omit-page'&&!faulted&&input.some(s=>s.sql.startsWith('INSERT INTO app_recovery_capture_pages'))){faulted=true;statements=input.filter(s=>!s.sql.startsWith('INSERT INTO app_recovery_capture_pages'));}
  const result=await base.batch(statements);metrics.returnedBytes+=new TextEncoder().encode(JSON.stringify(result)).length;
  if(body.fault==='lost-ack'&&!faulted&&input.some(s=>s.sql.startsWith('UPDATE app_recovery_captures SET checkpoint_json'))){faulted=true;throw Error('Synthetic lost acknowledgement.');}return result;
 }},artifacts={async getVerified(identity:any){metrics.reads++;const r=await backing.getVerified(identity);if(r.status==='verified')metrics.objectBytes+=r.bytes.length;return r;},async putIfAbsent(identity:any,bytes:Uint8Array){metrics.writes++;metrics.objectBytes+=bytes.length;return backing.putIfAbsent(identity,bytes);}},ports={driver,artifacts,crypto,clock:{nowMs:()=>1},schema:body.schema,v2Codec:createRecoveryV2Codec({crypto})},source=createRecoveryV2CaptureSource(ports);
 let result;
 if(body.method==='capture')result=await createRecoveryV2Capture({...ports,codec:createManifestCodec({crypto})}).step(body.input);
 else if(body.method==='start')result=await source.start(body.input);
 else if(body.method==='references'){const run=await source.load(body.input.captureId);result=await createRecoveryV2ReferenceCapture({...ports,codec:createManifestCodec({crypto}),source}).step(run);}
 else result=await source.step(body.input);
 return Response.json({result,metrics,faulted});
}};
