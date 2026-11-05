import {sql,revisions} from '../storage/atomic-driver.mjs';
import {createCutoffSnapshotRepository} from '../storage/cutoff-snapshot.mjs';
import {buildRequirementSpecs,selectRequirementReceipts} from '../evidence/requirements.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {privateIdentity} from '../artifacts/identity.mjs';
import {name,nat,requireValue} from './validation.mjs';
const clone=value=>JSON.parse(canonicalJson(value));
const pending=reason=>({kind:'pending',reason});
// Explicit private reconciliation of current external receipts against a final
// board. New conflicting evidence creates an incident; it never edits awards.
export function createSettlementReconciler({driver,artifacts,crypto,clock,principal,ids}){
 const operator=clone(principal);requireValue(operator.kind==='operator','Operator required.');name(operator.id,'operator');
 const read=async statements=>(await driver.batch(statements)).map(r=>r.rows),hash=value=>crypto.sha256(utf8(canonicalJson(value)));
 const snapshots=createCutoffSnapshotRepository(driver,{crypto,ids});
 return Object.freeze({async inspectBoard({epoch}){
  nat(epoch,'epoch');
  const [versionRows,rows,grants]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),
   sql(`SELECT b.snapshot_hash,i.manifest_digest,i.object_key,i.byte_digest,a.size,a.semantic_digest,a.content_type
    FROM earn_boards b JOIN app_command_receipts r ON r.operation_kind='earn.commit-board.v1' AND r.state='committed' AND r.result_ref=b.snapshot_hash
    JOIN app_complete_inputs i ON i.manifest_digest=json_extract(r.input_json,'$.manifestDigest')
    JOIN app_snapshot_attempts s ON s.manifest_digest=i.manifest_digest AND s.status='ready'
    JOIN app_private_artifacts a ON a.object_key=i.object_key WHERE b.epoch=?`,epoch),
   sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='earn-settlement'",operator.id)]);
  if(!grants[0]?.enabled)return {kind:'conflict',code:'operator_scope_required'};
  if(!rows[0])return pending('final-manifest-required');
  const r=rows[0],version=revisions(versionRows);let size=0,pages=0;
  const object=async raw=>{
   const identity=privateIdentity(raw);size+=identity.size;if(size>24*1024*1024||++pages>512)throw Error('reconciliation-artifact-bound');
   const stored=await artifacts.getVerified(identity);if(stored.status!=='verified')throw Error('reconciliation-object-'+stored.status);
   const bytes=new Uint8Array(stored.bytes);if(bytes.length!==identity.size||await crypto.sha256(bytes)!==identity.byteDigest)throw Error('reconciliation-object-conflict');
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);if(canonicalJson(value)!==text)throw Error('reconciliation-object-canonical');return value;
  };
  let manifest,facts=[],oldEvidence=[];
  try{
   manifest=await object({key:r.object_key,byteDigest:r.byte_digest,size:r.size,semanticDigest:r.semantic_digest,contentType:r.content_type,visibility:'private'});
   if(manifest.epoch!==epoch||manifest.status!=='ready'||await hash(['cutoff-manifest-v1',manifest])!==r.manifest_digest)throw Error('reconciliation-manifest-identity');
   for(const [kind,items] of [['frozen-facts',facts],['evidence',oldEvidence]]){
    const refs=manifest.artifacts[kind];if(!Array.isArray(refs)||!refs.length||refs.length>512)throw Error('reconciliation-page-bound');
    for(let index=0;index<refs.length;index++){const p=await object(refs[index]);if(p.version!==1||p.kind!==kind||p.index!==index||!Array.isArray(p.items)||items.length+p.items.length>16384)throw Error('reconciliation-page-identity');items.push(...p.items);}
   }
   if(await hash(['cutoff-evidence-v1',oldEvidence])!==manifest.evidenceDigest)throw Error('reconciliation-evidence-identity');
  }catch(error){return pending(error.message);}
  const specs=await buildRequirementSpecs(facts,crypto),selected=await selectRequirementReceipts(specs,await snapshots.selectHeads(specs),crypto);
  if(canonicalJson(version)!==canonicalJson(await snapshots.readVersions()))return {kind:'conflict',code:'revision_conflict'};
  if(selected.evidenceDigest===manifest.evidenceDigest)return {kind:'consistent',epoch,snapshotId:r.snapshot_hash,evidenceDigest:manifest.evidenceDigest};
  const old=new Map(oldEvidence.map(e=>[e.requirementId,e])),changed=selected.evidence.filter(e=>canonicalJson(e)!==canonicalJson(old.get(e.requirementId)??null)).map(e=>e.requirementId);
  if(utf8(canonicalJson(changed)).length>128*1024)return pending('reconciliation-incident-bound');
  const id=await hash(['final-evidence-conflict-v1',r.snapshot_hash,r.manifest_digest,selected.evidenceDigest]);
  const statement=sql(`INSERT INTO app_settlement_incidents SELECT ?,?,?,?,?,?,?,?,?,? WHERE
   (SELECT revision FROM app_revisions WHERE name='earn')=? AND (SELECT revision FROM app_revisions WHERE name='source')=?
   AND (SELECT revision FROM app_revisions WHERE name='control')=?
   AND EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='earn-settlement' AND enabled=1)
   AND EXISTS(SELECT 1 FROM earn_boards WHERE epoch=? AND snapshot_hash=?) ON CONFLICT(id) DO NOTHING`,
   id,epoch,r.snapshot_hash,r.manifest_digest,manifest.evidenceDigest,selected.evidenceDigest,canonicalJson(changed),version.source,nat(clock.nowMs(),'now'),operator.id,
   Number(version.earn),Number(version.source),Number(version.control),operator.id,epoch,r.snapshot_hash);
  let failed=false;try{await driver.batch([statement]);}catch{failed=true;}
  const [incidents]=await read([sql('SELECT id FROM app_settlement_incidents WHERE id=?',id)]);
  return incidents.length?{kind:'incident',id,epoch,snapshotId:r.snapshot_hash,changedRequirements:changed.length,awardsPreserved:true}:failed?pending('reconciliation-outcome-unknown'):{kind:'conflict',code:'revision_conflict'};
 }});
}
