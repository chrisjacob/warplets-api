import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions,matchesExpectedRevisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {clone,validateSource,validateEnvelope,streamKey,requireEvidence,digest,text,time} from './envelope.mjs';
export const REGISTER_SOURCE='evidence.register-source.v1',RECORD_RECEIPT='evidence.record-receipt.v1';
export const evidenceCommandBytes=c=>utf8(canonicalJson([c.operationKind,c.principal,c.input,c.expectedRevisions]));
const conflict=code=>({kind:'conflict',code}),pending=reason=>({kind:'pending',reason,dependencyIds:[]});
const grant="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='evidence-ingest' AND enabled=1)";
export function createEvidenceRepository(driver,ports){
 const {read,replay,execute}=createAtomicReceipts(driver,ports),hash=v=>ports.crypto.sha256(utf8(canonicalJson(v)));
 function principal(p){requireEvidence(p?.kind==='operator'&&text(p.id),'evidence-operator-required');}
 async function validate(value,kind){
  const c=clone(value);principal(c.principal);requireEvidence(c.operationKind===kind&&text(c.requestKey)&&time(c.nowMs),'invalid-evidence-command');
  requireEvidence(c.requestDigest===await ports.crypto.sha256(evidenceCommandBytes(c)),'evidence-request-digest');return c;
 }
 async function capture(c){
  const [rows,grants]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='evidence-ingest'",c.principal.id)]);
  const version=revisions(rows);if(!matchesExpectedRevisions(c.expectedRevisions,version))return {error:conflict('revision_conflict')};
  if(!grants[0]?.enabled)return {error:conflict('operator_scope_required')};return {version};
 }
 return Object.freeze({
  async hasPrivateObject(i){const [rows]=await read([sql('SELECT byte_digest,size,content_type FROM app_private_artifacts WHERE object_key=?',i.key)]);return !!rows[0]&&rows[0].byte_digest===i.byteDigest&&rows[0].size===i.size&&rows[0].content_type===i.contentType;},
  async readSource(sourceId,revision){const [rows]=await read([sql('SELECT config_json FROM app_evidence_sources WHERE source_id=? AND source_revision=?',sourceId,revision)]);return rows[0]?JSON.parse(rows[0].config_json):null;},
  async findEvidence(p,evidenceId){
   principal(p);const [rows]=await read([sql(`SELECT c.request_key,c.request_digest FROM app_evidence_receipts r JOIN app_command_receipts c ON c.operation_id=r.operation_id
     WHERE r.evidence_id=? AND c.principal_key=?`,evidenceId,'operator:'+p.id)]);
   return rows[0]?replay({principal:p,operationKind:RECORD_RECEIPT,requestKey:rows[0].request_key,requestDigest:rows[0].request_digest}):null;
  },
  async selectHead(key){const [rows]=await read([sql(`SELECT r.* FROM app_evidence_heads h JOIN app_evidence_receipts r ON r.receipt_digest=h.receipt_digest WHERE h.stream_key=?`,key)]);
   return rows[0]?{receiptDigest:rows[0].receipt_digest,envelope:JSON.parse(rows[0].envelope_json),decision:JSON.parse(rows[0].decision_json)}:null;},
  async registerSource(value){
   const c=await validate(value,REGISTER_SOURCE),i=c.input,source=validateSource(JSON.parse(i.configJson));
   requireEvidence(i.sourceId===source.sourceId&&i.sourceRevision===source.sourceRevision&&canonicalJson(source)===i.configJson&&await hash(source)===i.configDigest,'source-config-digest');
   requireEvidence(c.businessIdentity===canonicalJson([i.sourceId,i.sourceRevision]),'source-business-key');
   const prior=await replay(c);if(prior)return prior;const captured=await capture(c);if(captured.error)return captured.error;
   const [existing]=await read([sql('SELECT config_digest FROM app_evidence_sources WHERE source_id=? AND source_revision=?',i.sourceId,i.sourceRevision)]);
   if(existing.length)return conflict('source_revision_exists');
   return execute(c,{businessKey:c.businessIdentity,input:i,result:source,resultRef:i.configDigest,version:captured.version,authoritySql:grant,authorityValues:[c.principal.id],
    child:(gate,v)=>sql(`INSERT INTO app_evidence_sources SELECT ?,?,?,?, ?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,
     i.sourceId,i.sourceRevision,i.configDigest,i.configJson,c.nowMs,...v,...v)});
  },
  async recordReceipt(value){
   const c=await validate(value,RECORD_RECEIPT),i=c.input,e=validateEnvelope(JSON.parse(i.envelopeJson)),d=JSON.parse(i.decisionJson);
   requireEvidence(c.businessIdentity===e.evidenceId&&i.evidenceId===e.evidenceId&&i.streamKey===streamKey(e)&&i.sourceId===e.sourceId&&i.sourceRevision===e.sourceRevision&&i.objectKey===e.objectRef&&i.supersedes===e.supersedes,'receipt-envelope-identity');
   requireEvidence(c.nowMs===e.ingestedAtMs&&['verified','pending','incompatible','invalid'].includes(d.status)&&i.status===d.status&&text(d.reason)&&['decoder-only','synthetic-transcript'].includes(d.scope),'receipt-decision');
   requireEvidence(d.coverage&&typeof d.coverage.complete==='boolean'&&Array.isArray(d.coverage.gaps)&&d.coverage.gaps.length<=100&&d.coverage.gaps.every(text),'receipt-coverage');
   requireEvidence(!d.coverage.complete||(d.status==='verified'&&d.scope==='synthetic-transcript'&&e.mode==='synthetic-fixture'),'receipt-coverage-assurance');
   requireEvidence(canonicalJson(e)===i.envelopeJson&&canonicalJson(d)===i.decisionJson&&i.receiptDigest===await hash(['evidence-receipt-v1',e,d]),'receipt-digest');
   const prior=await replay(c);if(prior)return prior;const captured=await capture(c);if(captured.error)return captured.error;
   const [sources,objects,heads,parents]=await read([
    sql('SELECT config_json FROM app_evidence_sources WHERE source_id=? AND source_revision=?',i.sourceId,i.sourceRevision),
    sql('SELECT byte_digest FROM app_private_artifacts WHERE object_key=?',i.objectKey),
    sql('SELECT receipt_digest FROM app_evidence_heads WHERE stream_key=?',i.streamKey),
    sql('SELECT stream_key,source_id,envelope_json FROM app_evidence_receipts WHERE receipt_digest=?',i.supersedes),
   ]);
   if(!sources[0])return pending('source-registration-required');
   const source=JSON.parse(sources[0].config_json);
   requireEvidence(source.mode===e.mode&&source.chainGenesis===e.chainGenesis&&source.decoderVersion===e.decoderVersion&&canonicalJson(source.subject)===canonicalJson(e.subject),'source-envelope-mismatch');
   if(!objects[0]||objects[0].byte_digest!==e.byteDigest)return pending('verified-private-object-required');
   if((heads[0]?.receipt_digest??null)!==i.supersedes)return conflict('evidence_head_changed');
   if(i.supersedes!==null){
    if(!parents[0]||parents[0].stream_key!==i.streamKey||parents[0].source_id!==i.sourceId)return conflict('correction_identity_changed');
    const previous=JSON.parse(parents[0].envelope_json);
    if(previous.mode!==e.mode||previous.chainGenesis!==e.chainGenesis)return conflict('correction_provenance_changed');
   }
   const pointer=i.supersedes===null?'NOT EXISTS(SELECT 1 FROM app_evidence_heads WHERE stream_key=?)':'EXISTS(SELECT 1 FROM app_evidence_heads WHERE stream_key=? AND receipt_digest=?)';
   return execute(c,{businessKey:c.businessIdentity,input:i,result:{receiptDigest:i.receiptDigest,envelope:e,decision:d},resultRef:i.receiptDigest,version:captured.version,
    authoritySql:grant+' AND '+pointer,authorityValues:[c.principal.id,i.streamKey,...(i.supersedes===null?[]:[i.supersedes])],
    child:(gate,v)=>[
     sql(`INSERT INTO app_evidence_receipts SELECT ?,?,?,?,?,?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,
      i.receiptDigest,i.evidenceId,i.streamKey,i.sourceId,i.sourceRevision,i.objectKey,i.envelopeJson,i.decisionJson,i.status,i.supersedes,c.nowMs,...v,...v),
     sql(`INSERT INTO app_evidence_heads SELECT ?,? WHERE ${gate} ON CONFLICT(stream_key) DO UPDATE SET receipt_digest=excluded.receipt_digest`,i.streamKey,i.receiptDigest,...v),
    ]});
  },
 });
}
