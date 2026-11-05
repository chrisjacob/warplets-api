import {createAtomicReceipts} from './atomic-receipts.mjs';
import {sql,revisions,matchesExpectedRevisions} from './atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {streamKey} from '../evidence/envelope.mjs';
import {name,nat,requireValue} from '../earn/validation.mjs';
import {loadCutoffInventory} from './cutoff-inventory.mjs';
import {loadAtomicBoardInput} from './atomic-board-input.mjs';
export const SNAPSHOT_ATTEMPT='earn.snapshot-attempt.v1';
const bytes=c=>utf8(canonicalJson([SNAPSHOT_ATTEMPT,c.principal,c.input,c.expectedRevisions]));
export async function createSnapshotAttemptCommand({principal,input,nowMs,expectedRevisions},crypto){
 const c=JSON.parse(canonicalJson({principal,input,nowMs,expectedRevisions,operationKind:SNAPSHOT_ATTEMPT,businessIdentity:input.manifestDigest,requestKey:input.manifestDigest}));
 c.requestDigest=await crypto.sha256(bytes(c));return c;
}
export function createCutoffSnapshotRepository(driver,ports){
 const {read,replay,execute}=createAtomicReceipts(driver,ports);
 return Object.freeze({
  async hasPrivateObject(i){
   const [rows]=await read([sql('SELECT byte_digest,size,content_type,semantic_digest FROM app_private_artifacts WHERE object_key=?',i.key)]),r=rows[0];
   return !!r&&r.byte_digest===i.byteDigest&&r.size===i.size&&r.content_type===i.contentType&&r.semantic_digest===i.semanticDigest;
  },
  loadInventory(query){return loadCutoffInventory(driver,ports.crypto,query);},
  loadBoardInput(query){return loadAtomicBoardInput(driver,ports.crypto,query);},
  async selectHeads(specs){
   const selected=new Map(),external=specs.filter(s=>s.authority==='evidence');
   for(let offset=0;offset<external.length;offset+=50){
    const group=external.slice(offset,offset+50),keys=group.map(s=>streamKey({sourceId:s.sourceId,subject:s.subject,requestedCutoffMs:s.cutoffMs}));
    const [rows]=await read([sql(`SELECT h.stream_key,r.receipt_digest,r.envelope_json,r.decision_json FROM app_evidence_heads h
      JOIN app_evidence_receipts r ON r.receipt_digest=h.receipt_digest WHERE h.stream_key IN (SELECT value FROM json_each(?))`,JSON.stringify(keys))]);
    const found=new Map(rows.map(r=>[r.stream_key,r]));
    group.forEach((s,n)=>{const r=found.get(keys[n]);selected.set(s.id,r?{receiptDigest:r.receipt_digest,envelope:JSON.parse(r.envelope_json),decision:JSON.parse(r.decision_json)}:null);});
   }return selected;
  },
  async readVersions(){return revisions((await read([sql('SELECT * FROM app_revisions ORDER BY name')]))[0]);},
  async readPointer(epoch){const [rows]=await read([sql('SELECT manifest_digest FROM app_epoch_inputs WHERE epoch=?',epoch)]);return rows[0]?.manifest_digest??null;},
  async recordAttempt(value){
   const c=JSON.parse(canonicalJson(value)),i=c.input;name(c.principal?.id,'operator');nat(c.nowMs,'now');nat(i.epoch,'epoch');
   requireValue(c.principal.kind==='operator'&&c.operationKind===SNAPSHOT_ATTEMPT&&c.businessIdentity===i.manifestDigest&&c.requestKey===i.manifestDigest&&c.requestDigest===await ports.crypto.sha256(bytes(c)),'Invalid snapshot attempt command.');
   for(const key of ['manifestDigest','byteDigest','requirementsDigest','evidenceDigest'])requireValue(/^[a-f0-9]{64}$/.test(i[key]),'Invalid snapshot digest.');
   requireValue(['pending','ready'].includes(i.status)&&(i.status==='ready'?/^[a-f0-9]{64}$/.test(i.inputDigest):i.inputDigest===null),'Invalid snapshot status.');
   const prior=await replay(c);if(prior)return prior;
   const [versions,objects,existing,grants]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),sql('SELECT * FROM app_private_artifacts WHERE object_key=?',i.objectKey),
    sql('SELECT * FROM app_snapshot_attempts WHERE manifest_digest=?',i.manifestDigest),sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='earn-snapshot'",c.principal.id)]);
   const version=revisions(versions);if(!matchesExpectedRevisions(c.expectedRevisions,version))return {kind:'conflict',code:'revision_conflict'};
   if(!objects[0]||objects[0].byte_digest!==i.byteDigest||objects[0].semantic_digest!==i.manifestDigest)return {kind:'pending',reason:'verified-manifest-required',dependencyIds:[i.objectKey]};
   if(existing[0]){
    if(!grants[0]?.enabled)return {kind:'conflict',code:'operator_scope_required'};
    const r=existing[0],expected={epoch:r.epoch,status:r.status,manifestDigest:r.manifest_digest,objectKey:r.object_key,byteDigest:r.byte_digest,requirementsDigest:r.requirements_digest,evidenceDigest:r.evidence_digest,inputDigest:r.input_digest};
    return canonicalJson(expected)===canonicalJson(i)&&r.dependency_versions===canonicalJson(version)?{kind:'replayed',value:i}:{kind:'conflict',code:'snapshot_identity_conflict'};
   }
   return execute(c,{businessKey:c.businessIdentity,input:i,result:i,resultRef:i.manifestDigest,version,
    authoritySql:"EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='earn-snapshot' AND enabled=1)",authorityValues:[c.principal.id],
    child:(gate,v)=>sql(`INSERT INTO app_snapshot_attempts SELECT ?,?,?,?,?,?,?,?,?,?,operation_id FROM app_command_receipts
      WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,
     i.manifestDigest,i.epoch,i.status,i.objectKey,i.byteDigest,i.requirementsDigest,i.evidenceDigest,i.inputDigest,canonicalJson(version),c.nowMs,...v,...v)});
  },
 });
}
