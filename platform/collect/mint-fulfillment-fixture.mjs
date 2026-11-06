import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createRecordedReader} from '../evidence/recorded.mjs';
/** Synthetic retained mint evidence only; a captured signed beacon does not
 * establish an on-chain mint or successful payment. */
export async function mintFulfillmentFixture({crypto,event}){
 const captured=JSON.parse(canonicalJson(event)),sourceId='synthetic-mint-fulfillment:'+captured.operationId,subject={kind:'collection-operation',id:captured.operationId},bytes=utf8(canonicalJson({version:1,mode:'synthetic-fixture',...captured})),reader=await createRecordedReader({mode:'synthetic-fixture',chainGenesis:null,records:[{id:'result',subject,contextSlot:'1',blockTimeMs:captured.atMs,retrievedAtMs:captured.atMs,finality:'finalized',bytes}],crypto});
 const source={version:1,sourceId,sourceRevision:reader.recordingDigest,mode:'synthetic-fixture',chainGenesis:null,decoderVersion:'synthetic-collection-mint-v1',subject,policy:{inventoryId:captured.inventoryId,operationId:captured.operationId},recordingDigest:reader.recordingDigest,maxBytes:16384,maxAgeMs:86400000};
 return {source,readers:new Map([[canonicalJson([sourceId,source.sourceRevision]),reader]]),request:{sourceId,sourceRevision:source.sourceRevision,recordId:'result',requestedCutoffMs:null,supersedes:null}};
}
