import {canonicalJson,utf8} from '../../security/canonical.mjs';
import {createRecordedReader} from '../../evidence/recorded.mjs';
/** Explicit retained synthetic progression payload. Configured payloads retain
 * the captured signed beacon, which the repository independently verifies. */
export async function collectionFulfillmentFixture({crypto,event}){
 const sourceId='synthetic-fulfillment:'+event.operationId,subject={kind:'collection-operation',id:event.operationId},bytes=utf8(canonicalJson({version:1,mode:'synthetic-fixture',...event})),records=[{id:'result',subject,contextSlot:'1',blockTimeMs:event.atMs,retrievedAtMs:event.atMs,finality:'finalized',bytes}],reader=await createRecordedReader({mode:'synthetic-fixture',chainGenesis:null,records,crypto});
 const source={version:1,sourceId,sourceRevision:reader.recordingDigest,mode:'synthetic-fixture',chainGenesis:null,decoderVersion:'synthetic-collection-progression-v1',subject,policy:{inventoryId:event.inventoryId,operationId:event.operationId},recordingDigest:reader.recordingDigest,maxBytes:16384,maxAgeMs:86400000};
 return {source,readers:new Map([[canonicalJson([sourceId,source.sourceRevision]),reader]]),request:{sourceId,sourceRevision:source.sourceRevision,recordId:'result',requestedCutoffMs:null,supersedes:null}};
}
