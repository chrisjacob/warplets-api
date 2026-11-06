import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createRecoveryV2CaptureSource} from './v2-capture-source.mjs';
import {createRecoveryV2ReferenceCapture} from './v2-capture-references.mjs';
import {createRecoveryV2IndexCapture} from './v2-capture-indexes.mjs';
/** Private local continuation API. A ready pin binds a complete immutable
 * capture graph; it does not authorize restore or production financial work. */
export function createRecoveryV2Capture(ports){
 const source=createRecoveryV2CaptureSource(ports),references=createRecoveryV2ReferenceCapture({...ports,source}),indexes=createRecoveryV2IndexCapture({...ports,source});
 async function result(run){
  if(run.state==='ready'){const bytes=utf8(run.root_json),value=await ports.v2Codec.verifyRoot(bytes,run.root_digest);return {kind:'captured',captureId:run.id,revision:run.revision,value,bytes,digest:run.root_digest};}
  return run.state==='held'?{kind:'held',captureId:run.id,revision:run.revision,reason:run.reason}:{kind:'replayed',captureId:run.id,revision:run.revision,phase:run.state};
 }
 async function continuation(input,finish){
  const request=JSON.parse(canonicalJson(input));if(Object.keys(request).length!==2||typeof request.captureId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(request.captureId)||!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0)throw new TypeError('Invalid v2 capture continuation.');
  const run=await source.load(request.captureId);if(!run)return {kind:'conflict',code:'capture-not-started'};
  if(run.revision<request.expectedRevision)return {kind:'conflict',code:'capture-revision-conflict'};
  if(run.state==='ready'||run.state==='held'||run.revision>request.expectedRevision)return result(run);
  const checkpoint=JSON.parse(run.checkpoint_json);
  if(finish)return run.state==='indexing'&&checkpoint.phase==='root'?indexes.finish(run):{kind:'conflict',code:'capture-not-verified'};
  if(run.state==='reading')return source.step(request);
  if(run.state==='verifying')return references.step(run);
  if(run.state==='indexing')return checkpoint.phase==='root'?indexes.finish(run):indexes.step(run);
  return {kind:'conflict',code:'capture-not-active'};
 }
 return Object.freeze({async start(input){const answer=await source.start(input);return answer.phase==='ready'?result(await source.load(answer.captureId)):answer;},step:input=>continuation(input,false),finish:input=>continuation(input,true)});
}
