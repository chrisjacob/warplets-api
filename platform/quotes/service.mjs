import {canonicalJson,utf8} from '../security/canonical.mjs';
import {clone,streamKey,requireEvidence,text} from '../evidence/envelope.mjs';
import {QuoteError,requireQuote} from './math.mjs';
import {verifyQuoteCapture,evaluateVerifiedQuote} from './verification.mjs';
import {BIND_QUOTE_SOURCE,RECORD_QUOTE_INPUT,quoteCommandBytes} from './repository.mjs';
const pending=reason=>({kind:'pending',reason,dependencyIds:[]});
const names=['pool','attMint','ogMint','attVault','ogVault'];
export function createQuoteService({repository,store,crypto,clock}){
 const hash=v=>crypto.sha256(utf8(canonicalJson(v)));
 async function command(operationKind,principal,input,businessIdentity){
  const c={operationKind,principal:clone(principal),input,businessIdentity,requestKey:businessIdentity,nowMs:clock.nowMs(),expectedRevisions:{}};
  c.requestDigest=await crypto.sha256(quoteCommandBytes(c));return c;
 }
 async function retry(fn,c){let r=await fn(c);if(r.kind==='conflict'&&r.code==='revision_conflict')r=await fn(c);return r;}
 function metadata(row){const m=JSON.parse(row.market_body);return {market:{id:row.market_id,attMint:m.attMint,ogMint:m.ogMint,poolAddress:m.poolAddress,activationMs:Date.parse(m.activatedAt)},supply:{originalUnits:row.original_units,manifestDigest:row.manifest_digest},supplyActivationMs:row.supply_activation_ms};}
 async function load(row){
  requireQuote(row,'evidence_unavailable','Register a quote source and retained raw evidence.',503);
  requireQuote(row.receipt_digest,'evidence_pending','The selected quote source has no receipt.',503);
  const meta=metadata(row),source=JSON.parse(row.config_json),envelope=JSON.parse(row.envelope_json),decision=JSON.parse(row.decision_json);
  requireQuote(canonicalJson(meta)===row.metadata_json&&meta.market.activationMs===meta.supplyActivationMs,'quote_binding_changed','Market or original supply binding changed.',503);
  requireQuote(envelope.sourceId===row.source_id&&envelope.sourceRevision===row.source_revision&&envelope.requestedCutoffMs===null,'quote_binding_changed','The source revision must be rebound.',503);
  requireQuote(await hash(['evidence-receipt-v1',envelope,decision])===row.receipt_digest,'invalid_receipt','Retained evidence receipt digest mismatch.',503);
  requireQuote(row.byte_digest===envelope.byteDigest&&row.size<=32768,'invalid_capture','Retained quote bytes are unavailable or oversized.',503);
  const identity={key:envelope.objectRef,byteDigest:row.byte_digest,size:row.size,semanticDigest:row.semantic_digest,contentType:row.content_type,visibility:'private'};
  let stored;try{stored=await store.getVerified(identity);}catch{throw new QuoteError('evidence_unavailable','Private quote capture read failed.',503);}
  requireQuote(stored?.status==='verified','evidence_unavailable','Private quote capture is missing or corrupt.',503);
  requireQuote(stored.bytes instanceof Uint8Array&&stored.bytes.length===row.size&&await crypto.sha256(stored.bytes)===envelope.byteDigest,'invalid_capture','Private quote bytes differ from their receipt.',503);
  let capture;try{capture=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(stored.bytes));}catch{throw new QuoteError('invalid_capture','Private quote capture is not JSON.',503);}
  const binding={receiptDigest:row.receipt_digest,selectedHeadDigest:row.receipt_digest,sourceId:row.source_id,sourceRevision:row.source_revision,
   sourceConfigDigest:row.source_config_digest,streamKey:row.stream_key,envelopeByteDigest:envelope.byteDigest,objectRef:envelope.objectRef,
   contextSlot:envelope.contextSlot,blockTimeMs:envelope.blockTimeMs,retrievedAtMs:envelope.retrievedAtMs,ingestedAtMs:envelope.ingestedAtMs};
  return {market:meta.market,supply:meta.supply,source,capture,binding,decision};
 }
 async function verified(marketId){
  for(let attempt=0;attempt<2;attempt++){
   const row=await repository.readContext(marketId);
   requireQuote(row?.input_status==='verified',row?.input_reason??'evidence_pending','The latest retained quote input is not verified.',503);
   const {decision,...value}=await load(row);
   requireQuote(decision.status==='verified','evidence_pending','The latest B04 observation is incomplete.',503);
   const input=await verifyQuoteCapture(value,crypto);
   requireQuote(canonicalJson(input)===row.body_json,'invalid_quote_input','The derived quote input differs from retained bytes.',503);
   if(canonicalJson(row)===canonicalJson(await repository.readContext(marketId)))return {input,row};
  }
  throw new QuoteError('quote_evidence_changed','Quote evidence changed during verification.',503);
 }
 return Object.freeze({
  async bind(principal,value){
   const p=clone(principal),{marketId,sourceId,sourceRevision,previousBinding=null}=clone(value),registered=await repository.readSource(sourceId,sourceRevision),meta=await repository.metadata(marketId);
   if(!registered||!meta)return pending('market-manifest-source-required');
   const bindingDigest=await hash(['quote-binding-v1',marketId,registered.digest,meta]);
   const input={marketId,sourceId,sourceRevision,sourceConfigDigest:registered.digest,bindingDigest,previousBinding,
    streamKey:streamKey({sourceId,subject:registered.source.subject,requestedCutoffMs:null}),metadataJson:canonicalJson(meta)};
   return retry(c=>repository.bind(c),await command(BIND_QUOTE_SOURCE,p,input,bindingDigest));
  },
  async materialize(principal,marketId){
   principal=clone(principal);requireEvidence(principal?.kind==='operator'&&text(principal.id),'quote-operator-required');const row=await repository.readContext(marketId);
   if(!row?.receipt_digest)return pending('quote-evidence-required');
   if(row.input_digest)return await repository.findInput(principal,row.input_digest)??{kind:'conflict',code:'quote_input_exists'};
   let value;try{value=await load(row);}catch(error){if(error instanceof QuoteError)return pending(error.code);throw error;}
   let body={},status=value.decision.status,reason=value.decision.reason;
   const accounts={};
   // Retain independently hashable bytes even when a different field is invalid.
   // Finalized account contradictions cannot disappear behind an oracle failure.
   for(const key of names){const a=value.capture?.accounts?.[key];
    if(a?.contextSlot===value.binding.contextSlot&&typeof a.data==='string'&&a.data.length<=4096){
     try{const decoded=atob(a.data);if(btoa(decoded)===a.data)accounts[key]=await crypto.sha256(Uint8Array.from(decoded,c=>c.charCodeAt(0)));}catch{}
    }
   }
   if(status==='verified')try{const {decision,...input}=value;body=await verifyQuoteCapture(input,crypto);status='verified';reason='synthetic-quote-validated';}
   catch(error){if(!(error instanceof QuoteError))throw error;status='invalid';reason=error.code;}
   const inputDigest=await hash(['quote-input-v1',row.binding_digest,row.receipt_digest]);
   const input={inputDigest,bindingDigest:row.binding_digest,marketId,receiptDigest:row.receipt_digest,contextSlot:value.binding.contextSlot,
    status,reason,bodyJson:canonicalJson(body),accountsJson:canonicalJson(accounts),captureJson:canonicalJson(value.capture)};
   return retry(c=>repository.recordInput(c),await command(RECORD_QUOTE_INPUT,principal,input,inputDigest));
  },
  async quote(value){const request=clone(value);
   for(let attempt=0;attempt<2;attempt++){
    const {input,row}=await verified(request.marketId),quote=await evaluateVerifiedQuote({input,request,evaluatedAtMs:clock.nowMs()},crypto);
    if(canonicalJson(row)===canonicalJson(await repository.readContext(request.marketId))){
     requireQuote(clock.nowMs()<Date.parse(quote.expiresAt),'quote_expired','The quote expired during verification.',503);return quote;
    }
   }
   throw new QuoteError('quote_evidence_changed','Quote evidence changed during evaluation.',503);
  },
  async availability(marketId){
   try{const {input}=await verified(marketId),now=clock.nowMs();
    requireQuote(now>=input.data.pool.activationMs,'preactivation','Pool activation is pending.',503);
    requireQuote(now<input.data.expiresMs,'expired','Retained quote evidence expired.',503);
    return {available:true,expiresAt:new Date(input.data.expiresMs).toISOString(),attDecimals:input.data.pool.attDecimals,ogDecimals:input.data.pool.ogDecimals,source:'local-fixture',executable:false};
   }catch(error){if(!(error instanceof QuoteError))throw error;return {available:false,reason:error.code,source:'local-fixture',executable:false};}
  },
 });
}
