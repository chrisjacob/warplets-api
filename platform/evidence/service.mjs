import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createPrivateReferenceService} from '../artifacts/reference-service.mjs';
import {clone,validateSource,validateEnvelope,streamKey,requireEvidence,text,time,digest} from './envelope.mjs';
import {REGISTER_SOURCE,RECORD_RECEIPT,evidenceCommandBytes} from './repository.mjs';
import {decodeRecorded} from './decoders.mjs';
const pending=(reason,dependencyIds=[])=>({kind:'pending',reason,dependencyIds});
export function createEvidenceService({repository,artifactRepository,store,crypto,clock,readers}){
 const artifacts=createPrivateReferenceService({store,repository:artifactRepository,crypto,clock});
 const hash=value=>crypto.sha256(utf8(canonicalJson(value)));
 const identity=p=>{requireEvidence(p?.kind==='operator'&&text(p.id),'evidence-operator-required');return Object.freeze({kind:'operator',id:p.id});};
 async function command(operationKind,principal,input,businessIdentity,requestKey,nowMs){
  const c={operationKind,principal,input,businessIdentity,requestKey,nowMs,expectedRevisions:{}};c.requestDigest=await crypto.sha256(evidenceCommandBytes(c));return c;
 }
 async function retry(commit,c){let result=await commit(c);if(result.kind==='conflict'&&result.code==='revision_conflict')result=await commit(c);return result;}
 return Object.freeze({
  async registerSource(p,value){
   const principal=identity(p),source=validateSource(value),nowMs=clock.nowMs();requireEvidence(time(nowMs),'ingestion-clock');
   const configDigest=await hash(source),input={sourceId:source.sourceId,sourceRevision:source.sourceRevision,configDigest,configJson:canonicalJson(source)};
   return retry(repository.registerSource,await command(REGISTER_SOURCE,principal,input,canonicalJson([source.sourceId,source.sourceRevision]),configDigest,nowMs));
  },
  async ingest(p,value){
   const principal=identity(p),request=clone(value);const {sourceId,sourceRevision,recordId,requestedCutoffMs,supersedes=null}=request;
   requireEvidence(text(sourceId)&&text(sourceRevision)&&text(recordId)&&(requestedCutoffMs===null||time(requestedCutoffMs))&&(supersedes===null||digest(supersedes)),'ingest-request');
   const source=await repository.readSource(sourceId,sourceRevision);if(!source)return pending('source-registration-required',[sourceId]);
   const evidenceId=await hash(['evidence-identity-v1',sourceId,sourceRevision,source.recordingDigest,recordId,requestedCutoffMs,supersedes]);
   const existing=await repository.findEvidence(principal,evidenceId);if(existing)return existing;
   const reader=readers.get(canonicalJson([sourceId,sourceRevision]));
   if(!reader)return pending('recorded-source-unavailable',[sourceId]);
   requireEvidence(reader.recordingDigest===source.recordingDigest&&reader.mode===source.mode&&reader.chainGenesis===source.chainGenesis,'recording-provenance-mismatch');
   const observed=await reader.read(recordId);if(!observed)return pending('recording-not-found',[recordId]);
   requireEvidence(observed.bytes instanceof Uint8Array,'reader-bytes');const {bytes,...metadata}=observed;const record={...clone(metadata),bytes:bytes.slice()};
   requireEvidence(record.id===recordId,'recording-id-mismatch');
   requireEvidence(await crypto.sha256(record.bytes)===record.byteDigest,'recording-byte-digest');
   requireEvidence(canonicalJson(record.subject)===canonicalJson(source.subject),'recording-subject-mismatch');
   const nowMs=clock.nowMs();requireEvidence(time(nowMs),'ingestion-clock');
   const envelope=validateEnvelope({version:1,evidenceId,mode:source.mode,chainGenesis:source.chainGenesis,sourceId,sourceRevision,subject:record.subject,
    requestedCutoffMs,contextSlot:record.contextSlot,blockTimeMs:record.blockTimeMs,retrievedAtMs:record.retrievedAtMs,ingestedAtMs:nowMs,finality:record.finality,
    decoderVersion:source.decoderVersion,byteDigest:record.byteDigest,objectRef:'private/'+record.byteDigest+'.json',supersedes});
   const result=decodeRecorded(source,record,envelope),receiptDigest=await hash(['evidence-receipt-v1',envelope,result]);
   const artifact={key:envelope.objectRef,byteDigest:envelope.byteDigest,size:record.bytes.length,semanticDigest:null,visibility:'private',contentType:'application/json'};
   const stored=await artifacts.persist(principal,{identity:artifact,bytes:record.bytes,requestKey:'evidence-bytes:'+artifact.byteDigest});
   if(!['committed','replayed'].includes(stored.kind)&&!(stored.kind==='conflict'&&stored.code==='artifact_reference_exists'&&await repository.hasPrivateObject(artifact)))return stored;
   const input={receiptDigest,evidenceId,streamKey:streamKey(envelope),sourceId,sourceRevision,objectKey:envelope.objectRef,
    envelopeJson:canonicalJson(envelope),decisionJson:canonicalJson(result),status:result.status,supersedes};
   return retry(repository.recordReceipt,await command(RECORD_RECEIPT,principal,input,evidenceId,evidenceId,nowMs));
  },
 });
}
