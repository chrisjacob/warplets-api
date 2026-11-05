import {canonicalJson,utf8} from '../security/canonical.mjs';
import {clone,requireEvidence,MAX_EVIDENCE_BYTES,text,time} from './envelope.mjs';
/** A registered recording manifest pins metadata AND byte digests. Caller envelope
 * assertions never upgrade this adapter's classification or historical coverage.
 * Recorded-public samples are decoder vectors, never complete ownership history.
 */
export async function createRecordedReader({mode,chainGenesis,records,crypto}){
 requireEvidence(['synthetic-fixture','recorded-public'].includes(mode),'recording-mode');
 requireEvidence(Array.isArray(records)&&records.length<=100,'recording-bound');
 const saved=new Map(),manifest=[];
 const originals=records.map(({bytes,...metadata})=>{requireEvidence(bytes instanceof Uint8Array&&bytes.length<=MAX_EVIDENCE_BYTES,'recording-bytes');return {...clone(metadata),bytes:bytes.slice()};});
 for(const original of originals){
  const {bytes,...metadata}=original,record=clone(metadata);
  requireEvidence(bytes instanceof Uint8Array&&bytes.length<=MAX_EVIDENCE_BYTES,'recording-bytes');
  const copy=bytes.slice();requireEvidence(text(record.id)&&!saved.has(record.id),'recording-id');
  requireEvidence(time(record.retrievedAtMs)&&record.subject&&text(record.subject.kind)&&text(record.subject.id),'recording-metadata');
  const byteDigest=await crypto.sha256(copy);
  const entry={...record,byteDigest};manifest.push(entry);saved.set(record.id,{...entry,bytes:copy});
 }
 manifest.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const recordingDigest=await crypto.sha256(utf8(canonicalJson([1,mode,chainGenesis,manifest])));
 let reads=0;
 return Object.freeze({mode,chainGenesis,recordingDigest,
  async read(id){reads++;const entry=saved.get(id);return entry?{...clone({...entry,bytes:null}),bytes:entry.bytes.slice()}:null;},
  counters:()=>({localReads:reads,providerAttempts:0})});
}
