import {canonicalJson,utf8} from '../security/canonical.mjs';
import {PLAN_PUBLICATION,PUBLISH_PUBLICATION,HOLD_PUBLICATION,createPublicationCommand} from '../storage/publication.mjs';
const clone=value=>JSON.parse(canonicalJson(value)),accepted=r=>['committed','replayed'].includes(r.kind);
const pending=reason=>({kind:'pending',reason,dependencyIds:[]});
// Exact public bytes are privately staged before a durable plan is recorded.
// An unknown public PUT always retries that same conditional immutable write.
export function createPublicationService({repository,store,privateReferences,codec,crypto,clock,principal}){
 const operator=clone(principal),hash=value=>crypto.sha256(utf8(canonicalJson(value)));
 if(operator.kind!=='operator')throw TypeError('Publication operator required.');
 async function hold(p,lease,reason){
  const result=await repository.hold(await createPublicationCommand(HOLD_PUBLICATION,{principal:operator,requestKey:p.id,nowMs:clock.nowMs(),input:{id:p.id,reason}},crypto),lease);
  return accepted(result)?pending(reason):result;
 }
 async function assembleBytes(p){
  const bytes=new Uint8Array(p.identity.size);let offset=0;
  for(const identity of p.staging){
   const stored=await store.getVerified(identity);if(stored.status!=='verified')return pending('publication-staging-'+stored.status);
   const chunk=new Uint8Array(stored.bytes);if(offset+chunk.length>bytes.length||chunk.length!==identity.size||await crypto.sha256(chunk)!==identity.byteDigest)return pending('publication-staging-conflict');
   bytes.set(chunk,offset);offset+=chunk.length;
  }
  if(offset!==bytes.length||await crypto.sha256(bytes)!==p.identity.byteDigest)return pending('publication-staging-conflict');
  return {kind:'ready',bytes};
 }
 return Object.freeze({async run({job,lease,signal}){
  job=clone(job);lease=clone(lease);const payload=job.payload;
  const allocation=Object.hasOwn(payload,'tokenId'),fields=allocation?['day','epoch','principal','snapshotId','tokenId']:['epoch','principal','snapshotId'];
  if(job.type!=='publish-archive'||canonicalJson(Object.keys(payload).sort())!==canonicalJson(fields.sort())||canonicalJson(payload.principal)!==canonicalJson(operator)||
   await hash(payload)!==lease.payloadDigest||job.businessKey!==lease.businessKey||job.id!==lease.jobId||job.payloadDigest!==lease.payloadDigest)return pending('publication-job-binding');
  const businessKey=allocation?'publish-allocation:'+await hash([payload.tokenId,payload.day,payload.snapshotId]):'publish-board:'+payload.snapshotId;
  if(job.businessKey!==businessKey)return pending('publication-job-binding');
  let p=await repository.readJob(job.businessKey);
  if(p?.state!=='published'&&!await repository.canPublish(operator))return pending('publication-authority');
  if(!p){
   for(let attempt=0;attempt<2&&!p;attempt++){
    if(signal?.aborted)return pending('publication-aborted');
    const loaded=await repository.loadSource({epoch:payload.epoch});if(loaded.kind!=='loaded')return loaded;
    if(loaded.source.board.snapshotId!==payload.snapshotId)return pending('publication-source-binding');
    if(allocation&&!loaded.source.allocations.some(a=>a.tokenId===payload.tokenId&&a.day===payload.day))return pending('publication-allocation-required');
    const built=await codec.build(loaded.source),staging=[];
    for(let offset=0;offset<built.bytes.length;offset+=128*1024){
     if(signal?.aborted)return pending('publication-aborted');
     const bytes=built.bytes.slice(offset,offset+128*1024),byteDigest=await crypto.sha256(bytes);
     const identity={key:'private/'+byteDigest+'.bin',byteDigest,size:bytes.length,semanticDigest:null,visibility:'private',contentType:'application/octet-stream'};
     const result=await privateReferences.persist(operator,{identity,bytes,requestKey:byteDigest});
     const reused=result.code==='artifact_reference_exists'&&await repository.hasPrivateObject(identity);
     if(!accepted(result)&&!reused)return result;staging.push(identity);
    }
    if(signal?.aborted)return pending('publication-aborted');
    const id=await hash(['earn-publication-v1',job.businessKey]),command=await createPublicationCommand(PLAN_PUBLICATION,{principal:operator,requestKey:job.businessKey,nowMs:clock.nowMs(),expectedRevisions:loaded.versions,
     input:{id,jobKey:job.businessKey,epoch:payload.epoch,identity:built.identity,sourceDigest:loaded.sourceDigest,selectionsJson:canonicalJson(loaded.selections),stagingJson:canonicalJson(staging)}},crypto);
    const result=await repository.plan(command,lease);
    if(accepted(result)||result.code==='publication_plan_exists')p=await repository.readJob(job.businessKey);
    else if(result.code!=='revision_conflict'||attempt===1)return result;
   }
  }
  if(!p)return pending('publication-plan-outcome-unknown');
  if(p.epoch!==payload.epoch)return pending('publication-source-binding');
  if(p.state==='held')return pending(p.heldReason);
  if(p.state==='published'){
   const stored=await store.getVerified(p.identity);if(stored.status!=='verified')return pending('published-object-'+stored.status);
   const bytes=new Uint8Array(stored.bytes);return bytes.length===p.identity.size&&await crypto.sha256(bytes)===p.identity.byteDigest?{kind:'published',publication:p}:pending('published-object-conflict');
  }
  const assembled=await assembleBytes(p);if(assembled.kind!=='ready')return assembled;
  try{await codec.verify(assembled.bytes,{semanticDigest:p.identity.semanticDigest,byteDigest:p.identity.byteDigest});}
  catch{return hold(p,lease,'publication-codec-conflict');}
  const source=await repository.loadSource({epoch:p.epoch,selections:p.selections});if(source.kind!=='loaded')return source;
  if(source.source.board.snapshotId!==payload.snapshotId)return hold(p,lease,'publication-source-binding');
  if(allocation&&!source.source.allocations.some(a=>a.tokenId===payload.tokenId&&a.day===payload.day))return hold(p,lease,'publication-allocation-required');
  if(source.sourceDigest!==p.sourceDigest)return hold(p,lease,'publication-source-changed');
  const rebuilt=await codec.build(source.source);
  if(canonicalJson(rebuilt.identity)!==canonicalJson(p.identity))return hold(p,lease,'publication-source-identity');
  if(signal?.aborted)return pending('publication-aborted');
  let put;
  try{put=await store.putIfAbsent(p.identity,assembled.bytes);}catch(error){if(error?.code==='artifact_conflict')return hold(p,lease,'publication-object-conflict');return pending('publication-write-unknown');}
  if(!['created','exists'].includes(put.status))return pending('publication-write-unknown');
  const verified=await store.getVerified(p.identity);
  if(verified.status==='conflict')return hold(p,lease,'publication-object-conflict');
  if(verified.status!=='verified')return pending('publication-object-'+verified.status);
  const readback=new Uint8Array(verified.bytes);
  if(readback.length!==p.identity.size||await crypto.sha256(readback)!==p.identity.byteDigest)return hold(p,lease,'publication-object-conflict');
  if(signal?.aborted)return pending('publication-outcome-unknown');
  const result=await repository.publish(await createPublicationCommand(PUBLISH_PUBLICATION,{principal:operator,requestKey:p.id,nowMs:clock.nowMs(),input:{id:p.id,verifiedIdentity:p.identity}},crypto),lease);
  return accepted(result)?{kind:'published',publication:await repository.get(p.id)}:result;
 }});
}
