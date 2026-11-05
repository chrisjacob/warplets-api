import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions,matchesExpectedRevisions} from '../storage/atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {clone,digest,text,time,streamKey,requireEvidence} from '../evidence/envelope.mjs';
import {verifyQuoteCapture} from './verification.mjs';
import {QuoteError} from './math.mjs';
export const BIND_QUOTE_SOURCE='quotes.bind-source.v1',RECORD_QUOTE_INPUT='quotes.record-input.v1';
export const quoteCommandBytes=c=>utf8(canonicalJson([c.operationKind,c.principal,c.input,c.expectedRevisions]));
const conflict=code=>({kind:'conflict',code}),pending=reason=>({kind:'pending',reason,dependencyIds:[]});
const grant="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='evidence-ingest' AND enabled=1)";
const names=['pool','attMint','ogMint','attVault','ogVault'];
const slot=s=>typeof s==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(s)&&BigInt(s)<=(1n<<64n)-1n;
export function createQuoteRepository(driver,ports){
 const {read,replay,execute}=createAtomicReceipts(driver,ports),hash=v=>ports.crypto.sha256(utf8(canonicalJson(v)));
 async function validate(value,kind){
  const c=clone(value);requireEvidence(c.principal?.kind==='operator'&&text(c.principal.id)&&c.operationKind===kind&&text(c.requestKey)&&time(c.nowMs),'quote-command');
  requireEvidence(c.requestDigest===await ports.crypto.sha256(quoteCommandBytes(c)),'quote-command-digest');return c;
 }
 async function metadata(marketId){
  const [markets,supplies]=await read([sql('SELECT body FROM market_fixtures WHERE id=?',marketId),sql('SELECT original_units,digest,activated_ms FROM vault_manifests WHERE id=?',marketId)]);
  if(!markets[0]||!supplies[0])return null;
  const m=JSON.parse(markets[0].body),s=supplies[0];
  return {market:{id:marketId,attMint:m.attMint,ogMint:m.ogMint,poolAddress:m.poolAddress,activationMs:Date.parse(m.activatedAt)},
   supply:{originalUnits:s.original_units,manifestDigest:s.digest},supplyActivationMs:s.activated_ms};
 }
 async function capture(c){
  const [rs,gs]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='evidence-ingest'",c.principal.id)]);
  const version=revisions(rs);if(!matchesExpectedRevisions(c.expectedRevisions,version))return {error:conflict('revision_conflict')};
  return gs[0]?.enabled?{version}:{error:conflict('operator_scope_required')};
 }
 return Object.freeze({metadata,
  async findInput(principal,inputDigest){
   requireEvidence(principal?.kind==='operator'&&text(principal.id),'quote-operator-required');
   const [rows]=await read([sql(`SELECT c.request_key,c.request_digest FROM app_quote_inputs i JOIN app_command_receipts c ON c.operation_id=i.operation_id WHERE i.input_digest=? AND c.principal_key=?`,inputDigest,'operator:'+principal.id)]);
   return rows[0]?replay({principal,operationKind:RECORD_QUOTE_INPUT,requestKey:rows[0].request_key,requestDigest:rows[0].request_digest}):null;
  },
  async readSource(sourceId,sourceRevision){const [rows]=await read([sql('SELECT config_digest,config_json FROM app_evidence_sources WHERE source_id=? AND source_revision=?',sourceId,sourceRevision)]);return rows[0]?{digest:rows[0].config_digest,source:JSON.parse(rows[0].config_json)}:null;},
  async readContext(marketId){
   // One joined read pins the source, selected B04 receipt, private object and
   // derived decision. A newer unmaterialized receipt therefore masks the old one.
   const [rows]=await read([sql(`SELECT b.*,s.config_json,r.receipt_digest,r.envelope_json,r.decision_json,
    a.byte_digest,a.size,a.content_type,a.semantic_digest,i.input_digest,i.status AS input_status,i.reason AS input_reason,i.body_json,
    m.body AS market_body,v.original_units,v.digest AS manifest_digest,v.activated_ms AS supply_activation_ms
    FROM app_quote_heads h JOIN app_quote_bindings b ON b.binding_digest=h.binding_digest
    JOIN app_evidence_sources s ON s.source_id=b.source_id AND s.source_revision=b.source_revision
    JOIN market_fixtures m ON m.id=b.market_id JOIN vault_manifests v ON v.id=b.market_id
    LEFT JOIN app_evidence_heads eh ON eh.stream_key=b.stream_key LEFT JOIN app_evidence_receipts r ON r.receipt_digest=eh.receipt_digest
    LEFT JOIN app_private_artifacts a ON a.object_key=r.object_key
    LEFT JOIN app_quote_inputs i ON i.binding_digest=b.binding_digest AND i.receipt_digest=r.receipt_digest WHERE h.market_id=?`,marketId)]);
   return rows[0]??null;
  },
  async bind(value){
   const c=await validate(value,BIND_QUOTE_SOURCE),i=c.input;
   requireEvidence(text(i.marketId)&&text(i.sourceId)&&text(i.sourceRevision)&&digest(i.sourceConfigDigest)&&digest(i.bindingDigest)&&(i.previousBinding===null||digest(i.previousBinding)),'quote-binding');
   requireEvidence(c.businessIdentity===i.bindingDigest,'quote-binding-business-key');
   const prior=await replay(c);if(prior)return prior;const captured=await capture(c);if(captured.error)return captured.error;
   const [sources,heads]=await read([sql('SELECT config_digest,config_json FROM app_evidence_sources WHERE source_id=? AND source_revision=?',i.sourceId,i.sourceRevision),sql('SELECT binding_digest FROM app_quote_heads WHERE market_id=?',i.marketId)]);
   if(!sources[0])return pending('source-registration-required');const source=JSON.parse(sources[0].config_json),meta=await metadata(i.marketId);
   requireEvidence(meta&&meta.market.activationMs===meta.supplyActivationMs&&canonicalJson(meta)===i.metadataJson,'quote-market-manifest-binding');
   requireEvidence(source.decoderVersion==='synthetic-quote-capture-v1'&&source.mode==='synthetic-fixture'&&source.subject.kind==='quote-market'&&source.subject.id===i.marketId&&source.policy.marketId===i.marketId,'quote-source-applicability');
   requireEvidence(sources[0].config_digest===i.sourceConfigDigest&&i.streamKey===streamKey({sourceId:i.sourceId,subject:source.subject,requestedCutoffMs:null}),'quote-source-binding');
   requireEvidence(i.bindingDigest===await hash(['quote-binding-v1',i.marketId,i.sourceConfigDigest,meta]),'quote-binding-digest');
   if((heads[0]?.binding_digest??null)!==i.previousBinding)return conflict('quote_binding_changed');
   const pointer=i.previousBinding===null?'NOT EXISTS(SELECT 1 FROM app_quote_heads WHERE market_id=?)':'EXISTS(SELECT 1 FROM app_quote_heads WHERE market_id=? AND binding_digest=?)';
   return execute(c,{businessKey:i.bindingDigest,input:i,result:{bindingDigest:i.bindingDigest,marketId:i.marketId},resultRef:i.bindingDigest,version:captured.version,
    authoritySql:grant+' AND '+pointer,authorityValues:[c.principal.id,i.marketId,...(i.previousBinding===null?[]:[i.previousBinding])],child:(gate,v)=>[
     sql(`INSERT INTO app_quote_bindings SELECT ?,?,?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,i.bindingDigest,i.marketId,i.sourceId,i.sourceRevision,i.sourceConfigDigest,i.streamKey,i.metadataJson,c.nowMs,...v,...v),
     sql(`INSERT INTO app_quote_heads SELECT ?,? WHERE ${gate} ON CONFLICT(market_id) DO UPDATE SET binding_digest=excluded.binding_digest`,i.marketId,i.bindingDigest,...v),
    ]});
  },
  async recordInput(value){
   const c=await validate(value,RECORD_QUOTE_INPUT),i=c.input;
   requireEvidence(text(i.marketId)&&[i.bindingDigest,i.receiptDigest,i.inputDigest].every(digest)&&(i.contextSlot===null||slot(i.contextSlot)),'quote-input-identity');
   requireEvidence(['verified','invalid','pending','incompatible'].includes(i.status)&&text(i.reason)&&typeof i.bodyJson==='string'&&utf8(i.bodyJson).length<=32768,'quote-input-decision');
   const accounts=JSON.parse(i.accountsJson);requireEvidence(accounts&&typeof accounts==='object'&&!Array.isArray(accounts)&&Object.keys(accounts).every(k=>names.includes(k)&&digest(accounts[k]))&&canonicalJson(accounts)===i.accountsJson,'quote-account-digests');
   requireEvidence(!Object.keys(accounts).length||slot(i.contextSlot),'quote-account-slot');
   requireEvidence(i.status!=='verified'||names.every(k=>digest(accounts[k])),'quote-verified-accounts');
   requireEvidence(i.inputDigest===await hash(['quote-input-v1',i.bindingDigest,i.receiptDigest])&&c.businessIdentity===i.inputDigest,'quote-input-digest');
   const prior=await replay(c);if(prior)return prior;const captured=await capture(c);if(captured.error)return captured.error;
   const current=await this.readContext(i.marketId);
   if(!current||current.binding_digest!==i.bindingDigest||current.receipt_digest!==i.receiptDigest)return conflict('quote_evidence_changed');
   if(current.input_digest)return conflict('quote_input_exists');
   const e=JSON.parse(current.envelope_json);requireEvidence(e.contextSlot===i.contextSlot&&e.sourceId===current.source_id&&e.sourceRevision===current.source_revision,'quote-receipt-binding');
   requireEvidence(typeof i.captureJson==='string'&&utf8(i.captureJson).length<=32768&&await ports.crypto.sha256(utf8(i.captureJson))===e.byteDigest,'quote-raw-byte-binding');
   const raw=JSON.parse(i.captureJson),computedAccounts={};requireEvidence(canonicalJson(raw)===i.captureJson,'quote-capture-canonical');
   for(const key of names){const a=raw?.accounts?.[key];if(a?.contextSlot===i.contextSlot&&typeof a.data==='string'&&a.data.length<=4096){
    try{const b=atob(a.data);if(btoa(b)===a.data)computedAccounts[key]=await ports.crypto.sha256(Uint8Array.from(b,c=>c.charCodeAt(0)));}catch{}
   }}
   requireEvidence(canonicalJson(computedAccounts)===i.accountsJson,'quote-account-byte-binding');
   const decision=JSON.parse(current.decision_json),meta=await metadata(i.marketId);
   requireEvidence(canonicalJson(meta)===current.metadata_json,'quote-market-manifest-binding');
   let computedStatus=decision.status,computedReason=decision.reason,computedBody={};
   if(computedStatus==='verified')try{
    computedBody=await verifyQuoteCapture({market:meta.market,supply:meta.supply,source:JSON.parse(current.config_json),capture:raw,
     binding:{receiptDigest:i.receiptDigest,selectedHeadDigest:i.receiptDigest,sourceId:current.source_id,sourceRevision:current.source_revision,
      sourceConfigDigest:current.source_config_digest,streamKey:current.stream_key,envelopeByteDigest:e.byteDigest,objectRef:e.objectRef,
      contextSlot:e.contextSlot,blockTimeMs:e.blockTimeMs,retrievedAtMs:e.retrievedAtMs,ingestedAtMs:e.ingestedAtMs}},ports.crypto);
    computedReason='synthetic-quote-validated';
   }catch(error){if(!(error instanceof QuoteError))throw error;computedStatus='invalid';computedReason=error.code;}
   requireEvidence(i.status===computedStatus&&i.reason===computedReason&&i.bodyJson===canonicalJson(computedBody),'quote-derived-input-mismatch');
   const [previous,slots]=await read([sql('SELECT context_slot FROM app_quote_inputs WHERE market_id=? AND context_slot IS NOT NULL ORDER BY length(context_slot) DESC,context_slot DESC LIMIT 1',i.marketId),sql('SELECT * FROM app_quote_account_slots WHERE market_id=? AND context_slot=?',i.marketId,i.contextSlot)]);
   let status=i.status,reason=i.reason;
   if(i.contextSlot!==null&&previous[0]&&BigInt(i.contextSlot)<BigInt(previous[0].context_slot)){status='invalid';reason='slot_regression';}
   if(slots.some(s=>s.conflict_input_digest!==null||accounts[s.account_kind]&&accounts[s.account_kind]!==s.byte_digest)){status='invalid';reason='finalized_slot_conflict';}
   const result={inputDigest:i.inputDigest,receiptDigest:i.receiptDigest,status,reason};
   return execute(c,{businessKey:i.inputDigest,input:i,result,resultRef:i.inputDigest,version:captured.version,
    authoritySql:grant+' AND EXISTS(SELECT 1 FROM app_quote_heads h JOIN app_quote_bindings b ON b.binding_digest=h.binding_digest JOIN app_evidence_heads e ON e.stream_key=b.stream_key WHERE h.market_id=? AND h.binding_digest=? AND e.receipt_digest=?)',
    authorityValues:[c.principal.id,i.marketId,i.bindingDigest,i.receiptDigest],child:(gate,v)=>[
     sql(`INSERT INTO app_quote_inputs SELECT ?,?,?,?,?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,
      i.inputDigest,i.bindingDigest,i.marketId,i.receiptDigest,i.contextSlot,status,reason,i.bodyJson,i.accountsJson,c.nowMs,...v,...v),
     ...Object.entries(accounts).map(([kind,byteDigest])=>sql(`INSERT INTO app_quote_account_slots SELECT ?,?,?,?,?,NULL WHERE ${gate}
      ON CONFLICT(market_id,account_kind,context_slot) DO UPDATE SET conflict_input_digest=CASE WHEN app_quote_account_slots.byte_digest<>excluded.byte_digest THEN COALESCE(app_quote_account_slots.conflict_input_digest,excluded.first_input_digest) ELSE app_quote_account_slots.conflict_input_digest END`,i.marketId,kind,i.contextSlot,byteDigest,i.inputDigest,...v)),
    ]});
  },
 });
}
