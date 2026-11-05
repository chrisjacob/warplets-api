import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createRecordedReader} from './recorded.mjs';
/** All positive end-to-end transcripts from this factory are synthetic fixtures. */
export async function evidenceFixture({crypto,payload,decoderVersion='spl-mint-v1',subject={kind:'mint',id:'fixture-mint'},policy={ownerProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'},records,mode='synthetic-fixture',chainGenesis=null,now=100000}){
 const entries=records??[{id:'first',subject,contextSlot:'10',blockTimeMs:now,retrievedAtMs:now,finality:'finalized',bytes:utf8(canonicalJson(payload))}];
 const reader=await createRecordedReader({mode,chainGenesis,records:entries,crypto});
 const source={version:1,sourceId:'fixture-source',sourceRevision:'v1',mode,chainGenesis,decoderVersion,subject,policy,recordingDigest:reader.recordingDigest,maxBytes:262144,maxAgeMs:300000};
 return {reader,source,readers:new Map([[canonicalJson([source.sourceId,source.sourceRevision]),reader]]),
  request:{sourceId:source.sourceId,sourceRevision:source.sourceRevision,recordId:entries[0].id,requestedCutoffMs:now,supersedes:null}};
}
