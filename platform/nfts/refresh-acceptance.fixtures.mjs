// Actual commands and retained explicit synthetic artifacts; no generated media.
import assert from 'node:assert/strict';
import {REFRESH_OWNER} from './refresh-repository.fixtures.mjs';
export async function completeRefreshRehearsal(f){
 const commands=[];const take=step=>{assert.equal(step.result.kind,'committed',JSON.stringify(step.result));commands.push(step.command);return step.result.value;};
 let ref=take(await f.create()),advance=async(kind,input)=>ref=take(await f.advance(ref,kind,input));
 await advance('validate-reference',{referenceDigest:f.referenceIdentity.byteDigest,recordingDigest:f.referenceIdentity.byteDigest,provenance:'recorded-synthetic-fixture'});
 await advance('queue-moderation',{providerKind:'recorded-synthetic-fixture',jobId:'retained-refresh-job'});
 const state=(await f.repo.read(REFRESH_OWNER,{requestId:ref.requestId})).value.state,media=await f.register('Explicit recorded preview bytes for recovery, no AI or image validation',true);
 const moderation=await f.register({format:'10x.refresh-preview-fixture.v1',provenance:'recorded-synthetic-fixture',requestId:ref.requestId,...state.job,referenceDigest:state.request.referenceDigest,quoteDigest:state.request.quoteDigest,mediaIdentity:media,decision:'approved'});
 const preview={previewDigest:media.byteDigest,quoteDigest:state.request.quoteDigest};
 await advance('record-preview',{...state.job,referenceDigest:state.request.referenceDigest,...preview,moderationDigest:moderation.byteDigest,provenance:'recorded-synthetic-fixture'});
 await advance('approve',preview);await advance('request-fulfillment',preview);
 const record=await f.register({format:'10x.refresh-fulfillment-fixture.v1',provenance:'recorded-synthetic-fixture',requestId:ref.requestId,...state.job,...preview,metadataApplied:false});
 await advance('fulfill-recording',{...state.job,...preview,recordingDigest:record.byteDigest,provenance:'recorded-synthetic-fixture'});
 return {ref,commands,state:(await f.repo.read(REFRESH_OWNER,{requestId:ref.requestId})).value.state};
}
