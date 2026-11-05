import {sql,revisions,matchesExpectedRevisions} from './atomic-driver.mjs';
import {createAtomicReceipts} from './atomic-receipts.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {artifactIdentity,privateIdentity} from '../artifacts/identity.mjs';
import {name,nat,requireValue} from '../earn/validation.mjs';
export const PLAN_PUBLICATION='artifacts.plan-publication.v1',PUBLISH_PUBLICATION='artifacts.publish-publication.v1',HOLD_PUBLICATION='artifacts.hold-publication.v1';
const clone=value=>JSON.parse(canonicalJson(value)),pending=reason=>({kind:'pending',reason,dependencyIds:[]}),conflict=code=>({kind:'conflict',code});
const requestBytes=c=>utf8(canonicalJson([c.operationKind,c.principal,c.input,c.expectedRevisions]));
const business=c=>c.operationKind===PLAN_PUBLICATION?c.input.jobKey:c.input.id;
export async function createPublicationCommand(operationKind,{principal,requestKey,input,nowMs,expectedRevisions={}},crypto){
 const c=clone({operationKind,principal,requestKey,input,nowMs,expectedRevisions});c.businessIdentity=business(c);c.requestDigest=await crypto.sha256(requestBytes(c));return c;
}
const publication=r=>r?{id:r.id,jobKey:r.job_key,epoch:r.epoch,identity:{key:r.object_key,byteDigest:r.byte_digest,size:r.size_bytes,semanticDigest:r.semantic_digest,visibility:'public',contentType:'application/json'},
 sourceDigest:r.source_digest,selections:JSON.parse(r.selections_json),sourceRevisions:JSON.parse(r.source_revisions),staging:JSON.parse(r.staging_json),state:r.state,
 createdMs:r.created_ms,verifiedMs:r.verified_ms,publishedMs:r.published_ms,heldReason:r.held_reason}:null;
export function createPublicationRepository(driver,ports){
 const {crypto,clock}=ports,{read,replay,execute}=createAtomicReceipts(driver,ports),hash=value=>crypto.sha256(utf8(canonicalJson(value)));
 const get=async id=>publication((await read([sql('SELECT * FROM app_artifact_publications WHERE id=?',id)]))[0][0]);
 async function validate(value,kind){
  const c=clone(value);requireValue(c.operationKind===kind&&c.principal?.kind==='operator','Invalid publication authority.');
  name(c.principal.id,'operator');name(c.requestKey,'request key');nat(c.nowMs,'now');
  requireValue(c.businessIdentity===business(c)&&c.requestDigest===await crypto.sha256(requestBytes(c)),'Invalid publication command digest.');return c;
 }
 function fence(c,lease,p){
  lease=clone(lease);requireValue(lease.businessKey===p.jobKey,'Publication lease belongs to another source job.');
  name(lease.token,'lease');name(lease.jobId,'job');requireValue(/^(0|[1-9][0-9]*)$/.test(lease.revision),'Invalid lease revision.');
  return {authoritySql:`EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='earn-publication' AND enabled=1)
   AND EXISTS(SELECT 1 FROM app_jobs j JOIN app_execution_fences f ON f.business_key=j.business_key
    WHERE j.id=? AND j.business_key=? AND j.principal=? AND j.type IN ('publish-archive','reconcile-publication') AND j.state='running'
     AND j.lease_token=? AND j.revision=? AND j.payload_digest=? AND f.holder_token=j.lease_token AND f.revision=j.revision
     AND f.payload_digest=j.payload_digest AND f.expires_ms>? AND f.expires_ms>${driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)"})`,
   authorityValues:()=>[c.principal.id,lease.jobId,p.jobKey,c.principal.id,lease.token,Number(lease.revision),lease.payloadDigest,nat(clock.nowMs(),'clock')]};
 }
 async function loadSource({epoch,selections}){
  selections=selections===undefined?undefined:clone(selections);
  nat(epoch,'epoch');if(selections!==undefined)requireValue(Array.isArray(selections)&&selections.length<=32&&selections.every(s=>typeof s.tokenId==='string'&&Number.isInteger(s.day)),'Invalid publication selection.');
  const [versionRows,boards,allAllocations,allAwards]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),sql('SELECT * FROM earn_boards WHERE epoch=?',epoch),
   sql(`SELECT a.*,c.activation_ms,c.original_units FROM earn_allocations a JOIN earn_fixture_campaigns c ON c.token_id=a.token_id WHERE a.epoch=? ORDER BY a.token_id,a.day LIMIT 33`,epoch),
   sql(`SELECT w.* FROM earn_awards w JOIN earn_allocations a ON a.token_id=w.token_id AND a.day=w.day WHERE a.epoch=? ORDER BY w.token_id,w.day,w.wallet LIMIT 3301`,epoch)]);
  if(!boards[0])return pending('publication-board-required');if(allAllocations.length>32||allAwards.length>3200)return pending('publication-source-bound');
  const b=boards[0],board={epoch,finalizedAtMs:b.finalized_ms,snapshotId:b.snapshot_hash,winners:JSON.parse(b.winners)};
  if(board.winners.length>100)return pending('publication-source-bound');
  const rows=selections?allAllocations.filter(a=>selections.some(s=>s.tokenId===a.token_id&&s.day===a.day)):allAllocations;
  if(selections&&rows.length!==selections.length)return pending('publication-allocation-required');
  const allocations=[];
  for(const a of rows){
   const awards=allAwards.filter(w=>w.token_id===a.token_id&&w.day===a.day),byWallet=new Map(awards.map(w=>[w.wallet,w.amount]));
   if(awards.length!==board.winners.length||board.winners.some(w=>!byWallet.has(w.wallet)))return pending('publication-awards-incomplete');
   allocations.push({tokenId:a.token_id,day:a.day,activationMs:a.activation_ms,originalUnits:a.original_units,startsAtMs:a.starts_ms,vestsFromMs:a.vests_from_ms,
    vestsThroughMs:a.vests_through_ms,budgetUnits:a.budget,burnUnits:a.burn,awards:board.winners.map(w=>({wallet:w.wallet,amountUnits:byWallet.get(w.wallet)}))});
  }
  const versions=revisions(versionRows),current=revisions((await read([sql('SELECT * FROM app_revisions ORDER BY name')]))[0]);
  if(canonicalJson(versions)!==canonicalJson(current))return conflict('revision_conflict');
  const source={board,allocations};return {kind:'loaded',source,versions,sourceDigest:await hash(source),selections:allocations.map(a=>({tokenId:a.tokenId,day:a.day}))};
 }
 return Object.freeze({loadSource,async readJob(jobKey){name(jobKey,'publication job');return publication((await read([sql('SELECT * FROM app_artifact_publications WHERE job_key=?',jobKey)]))[0][0]);},get,
  async canPublish(principal){const [rows]=await read([sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='earn-publication'",principal.id)]);return !!rows[0]?.enabled;},
  async hasPrivateObject(i){const [rows]=await read([sql('SELECT * FROM app_private_artifacts WHERE object_key=?',i.key)]),r=rows[0];return !!r&&r.byte_digest===i.byteDigest&&r.size===i.size&&r.content_type===i.contentType&&r.semantic_digest===i.semanticDigest;},
  async plan(value,lease){
   lease=clone(lease);
   const c=await validate(value,PLAN_PUBLICATION),prior=await replay(c);if(prior)return prior;const i=c.input,identity=artifactIdentity(i.identity);
   requireValue(identity.visibility==='public'&&identity.contentType==='application/json'&&identity.semanticDigest!==null&&i.id===await hash(['earn-publication-v1',i.jobKey]),'Invalid public publication identity.');
   const staging=JSON.parse(i.stagingJson).map(privateIdentity),selections=JSON.parse(i.selectionsJson);
   requireValue(staging.length>0&&staging.length<=16&&staging.every(s=>s.contentType==='application/octet-stream'&&s.semanticDigest===null&&s.size<=128*1024)&&staging.reduce((n,s)=>n+s.size,0)===identity.size,'Invalid publication staging vector.');
   const loaded=await loadSource({epoch:i.epoch,selections});if(loaded.kind!=='loaded')return loaded;
   if(loaded.sourceDigest!==i.sourceDigest)return conflict('publication_source_changed');if(!matchesExpectedRevisions(c.expectedRevisions,loaded.versions))return conflict('revision_conflict');
   const existing=await get(i.id);if(existing)return conflict('publication_plan_exists');
   return execute(c,{businessKey:c.businessIdentity,input:i,result:{id:i.id,identity,state:'planned'},resultRef:i.id,version:loaded.versions,...fence(c,lease,i),
    child:(gate,v)=>sql(`INSERT INTO app_artifact_publications(id,job_key,epoch,semantic_digest,byte_digest,object_key,size_bytes,source_digest,selections_json,source_revisions,staging_json,state,created_ms,plan_request_digest,principal,plan_operation_id)
     SELECT ?,?,?,?,?,?,?,?,?,?,?,'planned',?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,
     i.id,i.jobKey,i.epoch,identity.semanticDigest,identity.byteDigest,identity.key,identity.size,i.sourceDigest,i.selectionsJson,canonicalJson(loaded.versions),i.stagingJson,c.nowMs,c.requestDigest,c.principal.id,...v,...v)});
  },
  async publish(value,lease){
   lease=clone(lease);
   const c=await validate(value,PUBLISH_PUBLICATION),prior=await replay(c);if(prior)return prior;
   const p=await get(c.input.id);if(!p)return pending('publication-plan-required');if(p.state==='held')return pending(p.heldReason);if(p.state==='published')return {kind:'replayed',value:p};
   if(canonicalJson(c.input.verifiedIdentity)!==canonicalJson(p.identity))return conflict('publication_verification_identity');
   const loaded=await loadSource({epoch:p.epoch,selections:p.selections});if(loaded.kind!=='loaded')return loaded;
   if(loaded.sourceDigest!==p.sourceDigest)return conflict('publication_source_changed');
   if(!matchesExpectedRevisions(c.expectedRevisions,loaded.versions))return conflict('revision_conflict');
   return execute(c,{businessKey:c.businessIdentity,input:c.input,result:{id:p.id,identity:p.identity,state:'published'},resultRef:p.id,version:loaded.versions,...fence(c,lease,p),
    child:(gate,v)=>[
     sql(`INSERT INTO manifest_catalog SELECT ?,?,?,?,? WHERE ${gate} ON CONFLICT(byte_digest) DO NOTHING`,p.identity.byteDigest,p.identity.key,p.identity.size,'earn-archive-v1',c.nowMs,...v),
     sql(`UPDATE app_artifact_publications SET state='published',verified_ms=?,published_ms=?,published_operation_id=? WHERE id=? AND state IN ('planned','verified') AND ${gate}`,c.nowMs,c.nowMs,v[0],p.id,...v),
    ]});
  },
  async hold(value,lease){
   lease=clone(lease);
   const c=await validate(value,HOLD_PUBLICATION),prior=await replay(c);if(prior)return prior;name(c.input.reason,'hold reason');
   const p=await get(c.input.id);if(!p)return pending('publication-plan-required');if(p.state==='published')return conflict('publication_already_published');
   const version=revisions((await read([sql('SELECT * FROM app_revisions ORDER BY name')]))[0]);
   if(!matchesExpectedRevisions(c.expectedRevisions,version))return conflict('revision_conflict');
   return execute(c,{businessKey:c.businessIdentity,input:c.input,result:{id:p.id,state:'held',reason:c.input.reason},resultRef:p.id,version,...fence(c,lease,p),
    child:(gate,v)=>sql(`UPDATE app_artifact_publications SET state='held',held_reason=?,hold_operation_id=? WHERE id=? AND state IN ('planned','verified') AND ${gate}`,c.input.reason,v[0],p.id,...v)});
  },
 });
}
