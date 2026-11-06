import {sql} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {privateIdentity} from '../artifacts/identity.mjs';
import {prepareLegacyOriginalObject} from '../collect/legacy-adoption-preparation-plan.mjs';
import {auditLegacyMint} from '../collect/legacy-mint-audit.mjs';
const same=(a,b)=>canonicalJson(a)===canonicalJson(b),size=v=>utf8(canonicalJson(v)).length;
const need=(ok,reason)=>{if(!ok)throw new TypeError('Recovery original mint '+reason);};
const projection=(table,fields,where,args,max)=>{const body=`json_object(${fields.flatMap(k=>["'"+k+"'",k]).join(',')})`;return sql(`SELECT ${body} body FROM ${table} WHERE ${where} AND length(CAST(${body} AS BLOB))<=${max}`,...args);};
const parsed=rows=>rows.map(r=>JSON.parse(r.body));
const fields=['id','kind','inventory_id','owner','request_key','request_digest','commitment','created_ms','settled_ms','proof_id','evidence_digest','operation','receipt'];
const partIdentity=ref=>privateIdentity({key:'private/'+ref.byteDigest+'.json',byteDigest:ref.byteDigest,size:ref.size,semanticDigest:null,visibility:'private',contentType:'application/json'});

/** Recovery-only mapping of immutable original facts. Current asset owner,
 * traits and level are intentionally absent. Historical source pins are audit
 * inputs; the outer continuation supplies the current target watermark fence. */
export async function verifyRestoredOriginalMint({certificate,anchor,prefix},{ctx,crypto,createDigest,beaconVerifier}){
 const b=certificate,a=anchor,opId=a.operation.id,assetId=a.originalOutcome.assetId;
 let [operations,headers,bindings,vaults,observations,histories,counts,policies,requests,results]=await ctx.read([
  projection('collect_operations',fields,'id=?',[opId],16384),
  sql('SELECT id,kind,tranche,season_start seasonStart,origin_digest originDigest FROM collect_inventories WHERE id=?',b.inventoryId),
  projection('collect_assets',['id','inventory_id','bind_ms','slot'],'id=?',[assetId],2048),
  projection('vault_assets',['id','slot_key','coords'],'id=?',[assetId],2048),
  projection('vault_observations',['event_id','asset_id','kind','observed_ms','body'],'event_id=?',['collect:'+opId],8192),
  projection('collect_level_history',['asset_id','effective_ms','level','source_ref'],'source_ref=? AND (SELECT COUNT(*) FROM collect_level_history WHERE source_ref=?)<=1',[opId,opId],2048),
  sql('SELECT (SELECT COUNT(*) FROM collect_level_history WHERE source_ref=?) history,(SELECT COUNT(*) FROM fair_inventories WHERE inventory_id=?) policy,(SELECT COUNT(*) FROM fair_requests WHERE operation_id=?) request,(SELECT COUNT(*) FROM fair_results WHERE operation_id=?) result',opId,b.inventoryId,opId,opId),
  sql('SELECT inventory_id inventoryId,policy_hash policyHash,registered_ms registeredMs FROM fair_inventories WHERE inventory_id=? AND length(CAST(inventory_id AS BLOB))<=128 AND length(policy_hash)=64',b.inventoryId),
  sql('SELECT operation_id operationId,target_round targetRound,context_digest contextDigest FROM fair_requests WHERE operation_id=? AND length(context_digest)=64',opId),
  sql('SELECT operation_id operationId,proof_id proofId,signed_round signedRoundJson,fixture fixtureJson,settled_ms settledMs FROM fair_results WHERE operation_id=? AND length(CAST(signed_round AS BLOB))<=2048 AND length(CAST(fixture AS BLOB))<=4096 AND length(CAST(proof_id AS BLOB))<=128',opId)
 ]);
 need(operations.length===1&&headers.length===1&&bindings.length===1&&vaults.length===1&&observations.length===1&&counts.length===1&&counts[0].history===histories.length,'missing or oversized retained facts.');
 const operation=parsed(operations)[0],header=headers[0],facts={header,operation,collectBinding:parsed(bindings)[0],vaultBinding:parsed(vaults)[0],vaultObservation:parsed(observations)[0],initialHistory:parsed(histories)};
 const o=a.operation;
 need(header.id===b.inventoryId&&header.originDigest===b.originDigest&&operation.id===o.id&&operation.kind==='mint'&&operation.inventory_id===b.inventoryId&&operation.owner===o.wallet&&operation.request_key===o.requestKey&&operation.request_digest===o.requestDigest&&operation.commitment===o.commitment&&operation.created_ms===o.admittedAtMs&&operation.settled_ms===o.settledAtMs&&operation.proof_id===o.proofId&&operation.evidence_digest===o.evidenceDigest,'anchor operation identity.');
 const isConfigured=a.original?.kind==='configured',n=counts[0];
 need(isConfigured?n.policy===1&&n.request===1&&n.result===1&&policies.length===1&&requests.length===1&&results.length===1:a.original?.kind==='manual'&&n.policy===0&&n.request===0&&n.result===0,'original provenance lane.');
 let configured=isConfigured?{policy:policies[0],request:requests[0],result:results[0]}:null;
 operations=null;headers=null;bindings=null;vaults=null;observations=null;histories=null;counts=null;policies=null;requests=null;results=null;
 const identity=privateIdentity(a.original[isConfigured?'policy':'fixture']);need(identity.size>0&&identity.size<=8192&&identity.semanticDigest===null&&identity.contentType==='application/json'&&same(identity,a.original[isConfigured?'policy':'fixture']),'original identity.');
 ctx.retain({b,a,prefix,facts,configured});
 async function retainedObjects(identities){
  need(identities.length<=13,'policy part count.');
  const keys=identities.map(i=>i.key),[rows]=await ctx.read([sql('SELECT object_key,identity_json,body_json,body_digest FROM app_collection_legacy_adoption_objects WHERE adoption_id=? AND object_key IN (SELECT value FROM json_each(?)) AND length(CAST(identity_json AS BLOB))<=1024 AND length(CAST(body_json AS BLOB))<=8192',b.adoptionId,canonicalJson(keys))]);
  need(rows.length===identities.length,'retained object closure.');const byKey=new Map(rows.map(r=>[r.object_key,r]));
  for(const i of identities){const r=byKey.get(i.key);need(r&&r.identity_json===canonicalJson(i),'retained object identity.');const p=JSON.parse(r.body_json);need(canonicalJson(p)===r.body_json&&await crypto.sha256(utf8(r.body_json))===r.body_digest&&p.format==='legacy-adoption-object-proof-v1'&&p.adoptionId===b.adoptionId&&same(p.identity,i)&&Array.isArray(p.descriptorChildren),'retained object proof.');byKey.set(i.key,p);}
  return byKey;
 }
 let proof=(await retainedObjects([identity])).get(identity.key),bytes=await ctx.object(identity);
 let prepared=await prepareLegacyOriginalObject({adoptionId:b.adoptionId,identity,role:isConfigured?'configured-policy':'manual-mint',bytes},{crypto});need(same(prepared.body,proof),'original descriptor closure.');
 let original=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));bytes=null;proof=null;
 let partIdentities=new Map();
 if(isConfigured){need(same({inventoryId:original.inventoryId,policyHash:original.policyHash,registeredMs:original.registeredMs},configured.policy),'retained original policy identity.');const {format:ignored,...policy}=original;configured={...configured,policy};original=null;const children=prepared.body.descriptorChildren,proofs=await retainedObjects(children);for(const i of children){need(proofs.get(i.key).descriptorChildren.length===0,'policy part nesting.');partIdentities.set(i.key,i);}}
 prepared=null;ctx.retain({b,a,prefix,facts,configured,original,parts:[...partIdentities.values()]});
 const record=async(id,max)=>{let [rows]=await ctx.read([sql('SELECT id,size,CASE WHEN size BETWEEN 1 AND ? AND length(body_base64)<=4*((size+2)/3) THEN body_base64 END encoded FROM app_collection_records WHERE id=?',max,id)]);need(rows.length===1&&typeof rows[0].encoded==='string','source record missing.');const row=rows[0];ctx.working(size(rows)*2+row.size*3);const data=Uint8Array.from(atob(row.encoded),v=>v.charCodeAt(0));need(data.length===row.size&&await crypto.sha256(data)===id,'source record digest.');return {id,size:row.size,bytes:data};};
 let root=await record(b.rootId,131072);ctx.working(root.size*6);let rootBody=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(root.bytes));
 need(rootBody.source.inventoryId===b.inventoryId&&rootBody.source.revision===String(b.sourceRevision)&&rootBody.source.stateDigest===b.canonicalDigest&&rootBody.admissions.count===b.admitted&&rootBody.inventory.fulfilled===b.fulfilled&&same(rootBody.inventory.remaining,b.remaining),'historical root binding.');
 const pageId=rootBody.admissions.pageIds[prefix.pageIndex];rootBody=null;let page=await record(pageId,65536),auditInput={...facts,sourceRoot:root,admissionPage:page,asOfMs:b.createdMs,prefix,originalFixture:original,configured};
 ctx.working(5*(root.size+page.size)+3*size({...facts,asOfMs:b.createdMs,prefix,originalFixture:original,configured}));
 let auditPeak=0,maxPart=0;
 const pending=auditLegacyMint(auditInput,{crypto,createDigest,beaconVerifier,onWorkingBytes:peak=>{auditPeak=peak;ctx.working(peak+2*maxPart);},async readOriginalPolicyPart(ref){const i=partIdentity(ref);need(same(partIdentities.get(i.key),i),'unretained policy part.');maxPart=Math.max(maxPart,i.size);ctx.working(auditPeak+2*maxPart);return ctx.object(i);}});
 root=null;page=null;auditInput=null;
 const audited=await pending;need(audited.kind==='audited',audited.reason??'original audit incomplete.');need(same(audited.summary,a.originalOutcome),'retained original outcome.');return audited;
}
