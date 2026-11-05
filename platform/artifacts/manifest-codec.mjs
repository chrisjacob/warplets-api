import {canonicalJson,commitmentBytes,utf8} from '../security/canonical.mjs';
import * as core from '../earn/commitment-core.mjs';
import {launchAllocations} from '../domain/economics/index.mjs';
import {MAX_PUBLIC_ARTIFACT_BYTES,artifactIdentity} from './identity.mjs';
const copy=value=>JSON.parse(canonicalJson(value));
const compare=(a,b)=>a<b?-1:a>b?1:0;
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const requireValue=(condition,message)=>{if(!condition)throw new TypeError(message);};
const exact=(value,keys,label)=>requireValue(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),'Invalid '+label+' fields.');
const project=(value,keys)=>Object.fromEntries(keys.map(k=>[k,value[k]]));
const frozen=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;};
const allocationFields=['tokenId','day','activationMs','originalUnits','startsAtMs','vestsFromMs','vestsThroughMs','budgetUnits','burnUnits'];
function supplyPolicy(manifest){
 for(const a of manifest.allocations){
  requireValue(typeof a.originalUnits==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(a.originalUnits),'Invalid campaign supply encoding.');
  launchAllocations({supply:BigInt(a.originalUnits),activeSeasonWeight:0n});
 }
}
function proofShape(proof){
 exact(proof,['format','context','award','path','root'],'proof');
 exact(proof.context,['boardId','tokenId','day','vestsFromMs','vestsThroughMs'],'proof context');
 exact(proof.award,['wallet','amountUnits'],'proof award');
 requireValue(Array.isArray(proof.path)&&proof.path.length<=7,'Invalid proof path.');
 for(const step of proof.path)exact(step,['side','hash'],'proof sibling');
}
// The async runner and legacy synchronous wrapper consume the same operations.
// Public bundles retain the historical semantic format; object SHA-256 hashes
// canonical {sha256,manifest} bytes and is intentionally a separate identity.
export function createManifestCodec({crypto}){
 const commitment=(type,value)=>crypto.sha256(commitmentBytes(type,value));
 async function run(iterator){let step=iterator.next();while(!step.done)step=iterator.next(await commitment(...step.value));return step.value;}
 async function result(manifest,semanticDigest,bytes,verification){
  const byteDigest=await crypto.sha256(bytes),identity=artifactIdentity({key:'public/'+byteDigest+'.json',byteDigest,semanticDigest,size:bytes.length,visibility:'public',contentType:'application/json'});
  const bundle=frozen({sha256:semanticDigest,manifest});
  return Object.freeze({bundle,manifest:bundle.manifest,semanticDigest,byteDigest,bytes,identity,boardId:manifest.boardId,verification:frozen(verification)});
 }
 return Object.freeze({
  async build(input){
   // Project before cloning so no private caller fields can enter hash inputs,
   // output bytes or job payloads. Copy all selected values before the first await.
   requireValue(input?.board&&Array.isArray(input.board.winners)&&input.board.winners.length<=100,'Invalid committed board.');
   requireValue(Array.isArray(input.allocations)&&input.allocations.length<=32,'Invalid committed allocation count.');
   const board=copy({...project(input.board,['epoch','finalizedAtMs','snapshotId']),winners:input.board.winners.map(w=>project(w,core.winnerKeys))});
   const allocations=input.allocations.map(a=>{
    requireValue(Array.isArray(a.awards)&&a.awards.length<=100,'Invalid committed award count.');
    return copy({...project(a,allocationFields),awards:a.awards.map(w=>project(w,['wallet','amountUnits']))});
   }).sort((a,b)=>compare(a.tokenId,b.tokenId));
   requireValue(utf8(canonicalJson({board,allocations})).length<=MAX_PUBLIC_ARTIFACT_BYTES,'Public manifest exceeds2MiB.');
   const boardId=await commitment('board',board),manifest={format:core.FORMAT,board,boardId,allocations:[]};
   for(const a of allocations){const allocation={boardId,...a};manifest.allocations.push({...allocation,awardRoot:await run(core.awardRoot(core.allocationContext(allocation),a.awards))});}
   supplyPolicy(manifest);
   const semanticDigest=await commitment('manifest',manifest),verification=await run(core.verifyManifest(manifest,semanticDigest));
   const bytes=utf8(canonicalJson({sha256:semanticDigest,manifest}));requireValue(bytes.length<=MAX_PUBLIC_ARTIFACT_BYTES,'Public manifest exceeds2MiB.');
   return result(manifest,semanticDigest,bytes,verification);
  },
  async verify(input,pinned){
   requireValue(input instanceof Uint8Array&&input.length>0&&input.length<=MAX_PUBLIC_ARTIFACT_BYTES,'Public manifest exceeds2MiB or is empty.');
   const bytes=new Uint8Array(input),pins=copy(pinned);requireValue(digest(pins.semanticDigest),'Independent semantic digest required.');
   if(pins.byteDigest!==undefined)requireValue(digest(pins.byteDigest),'Invalid byte digest.');
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),bundle=JSON.parse(text);exact(bundle,['sha256','manifest'],'public bundle');
   requireValue(canonicalJson(bundle)===text,'Public bundle must use canonical JSON bytes.');
   requireValue(bundle.sha256===pins.semanticDigest,'Bundle semantic digest differs from pin.');
   if(pins.byteDigest!==undefined)requireValue(await crypto.sha256(bytes)===pins.byteDigest,'Bundle byte digest differs from pin.');
   const verification=await run(core.verifyManifest(bundle.manifest,pins.semanticDigest));supplyPolicy(bundle.manifest);
   return result(bundle.manifest,pins.semanticDigest,bytes,verification);
  },
  async proof(allocation,wallet){
   const captured=copy(allocation);requireValue(typeof wallet==='string'&&wallet.length>0&&wallet.length<=256,'Invalid proof wallet.');
   requireValue(Array.isArray(captured.awards)&&captured.awards.length<=100,'Invalid proof awards.');
   const proof=await run(core.makeAwardProof(captured,wallet));if(proof){proofShape(proof);requireValue(proof.root===captured.awardRoot,'Allocation proof root mismatch.');return frozen(proof);}return null;
  },
  async verifyProof(proof,expectedRoot){const captured=copy(proof);proofShape(captured);return run(core.verifyAwardProof(captured,expectedRoot));},
  async allocationDigest(allocation){const captured=copy(allocation);return commitment('allocation',captured);},
 });
}
