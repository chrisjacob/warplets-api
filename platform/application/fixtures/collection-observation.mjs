import {canonicalJson,utf8} from '../../security/canonical.mjs';
import {createRecordedReader} from '../../evidence/recorded.mjs';
/** Explicit synthetic event records, retained through the actual B04 pipeline. */
export async function collectionObservationFixture({crypto,inventoryId,assetId,events}){
 const sourceId='synthetic-observation:'+assetId,subject={kind:'collection-asset',id:assetId};
 const records=events.map((e,index)=>({id:e.id,subject,contextSlot:String(index+1),blockTimeMs:e.observedMs,retrievedAtMs:e.observedMs,finality:'finalized',bytes:utf8(canonicalJson({version:1,mode:'synthetic-fixture',inventoryId,assetId,kind:e.kind,observedMs:e.observedMs,from:e.from,to:e.to}))}));
 const reader=await createRecordedReader({mode:'synthetic-fixture',chainGenesis:null,records,crypto}),source={version:1,sourceId,sourceRevision:'synthetic-v1',mode:'synthetic-fixture',chainGenesis:null,decoderVersion:'synthetic-collection-observation-v1',subject,policy:{inventoryId,assetId},recordingDigest:reader.recordingDigest,maxBytes:16384,maxAgeMs:86400000};
 return {source,readers:new Map([[canonicalJson([sourceId,source.sourceRevision]),reader]]),request:(recordId,supersedes=null)=>({sourceId,sourceRevision:source.sourceRevision,recordId,requestedCutoffMs:null,supersedes})};
}
