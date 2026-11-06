import {canonicalJson,utf8} from '../security/canonical.mjs';
import {bindActionRequest,ActionPlanInputError} from './plan-contracts.mjs';
import {QuoteError} from '../quotes/math.mjs';
export const SWAP_PLAN_LIMITS=Object.freeze({contextBytes:131072,planBytes:16384,attempts:2});
const missing=Object.freeze(['typed-program-codec','swap-account-derivation','captured-program-parity','verified-funding-and-fees','recorded-unsigned-message','recorded-simulation','recorded-blockhash-lifetime']);
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
const pending=reason=>freeze({kind:'pending',reason,dependencyIds:[],wire:null,executable:false,financialExecution:false});
class Hold extends Error{}
const check=(v,reason)=>{if(!v)throw new Hold(reason);};
const time=v=>Number.isSafeInteger(v)&&v>=0;
/** The commitment uses retained authority fields, not mutable display metadata.
 * Live fencing still compares the complete source row. */
export async function swapPlanContextDigest(value,crypto){
 const text=canonicalJson(value);check(utf8(text).length<=SWAP_PLAN_LIMITS.contextBytes,'quote_context_bound');
 const {operation_id,...row}=JSON.parse(text),market=JSON.parse(row.market_body);
 row.market_body=canonicalJson({id:row.market_id,attMint:market.attMint,ogMint:market.ogMint,poolAddress:market.poolAddress,activationMs:Date.parse(market.activatedAt)});
 return crypto.sha256(utf8(canonicalJson(row)));
}
/** Read-only economic preparation. The injected quote service must be the actual
 * provenance-verifying B14 service; callers cannot supply a QuoteDto or sources. */
export function createSwapPlanService({quoteService,quoteRepository,crypto,clock}){
 const hash=v=>crypto.sha256(utf8(canonicalJson(v)));
 async function context(id){const row=await quoteRepository.readContext(id);check(row,'evidence_unavailable');const text=canonicalJson(row);check(utf8(text).length<=SWAP_PLAN_LIMITS.contextBytes,'quote_context_bound');return {row:JSON.parse(text),text};}
 return Object.freeze({async prepare(value){
  const bound=await bindActionRequest(value,crypto);if(bound.request.action!=='swap')throw new ActionPlanInputError();
  const parameters=bound.request.parameters;
  try{for(let attempt=0;attempt<SWAP_PLAN_LIMITS.attempts;attempt++){
   const before=await context(parameters.marketId),quote=structuredClone(await quoteService.quote(parameters));
   const row=before.row,source=JSON.parse(row.config_json),market=JSON.parse(row.market_body),input=JSON.parse(row.body_json),e=quote.evidence;
   check(row.input_status==='verified'&&e&&quote.source==='local-fixture'&&quote.executable===false,'quote_plan_binding');
   check(e.receiptDigest===row.receipt_digest&&e.sourceId===row.source_id&&e.sourceRevision===row.source_revision&&e.sourceConfigDigest===row.source_config_digest&&e.manifestDigest===row.manifest_digest&&e.captureByteDigest===row.byte_digest,'quote_plan_binding');
   check(quote.marketId===parameters.marketId&&quote.direction===parameters.direction&&quote.inputUnits===parameters.inputUnits&&quote.slippageBps===parameters.slippageBps&&quote.sourceHash===input.sourceDigest&&e.policyDigest===input.policyDigest&&canonicalJson(e.accountByteDigests)===canonicalJson(input.accountByteDigests),'quote_plan_binding');
   const activationMs=Date.parse(market.activatedAt);check(time(activationMs)&&activationMs===row.supply_activation_ms&&input.data.originalSupplyUnits===row.original_units,'quote_plan_binding');
   check(source.policy.programBinaryDigest===null&&e.programBinaryDigest===null&&e.capturedProgramParity==='missing','quote_program_evidence_unsupported');
   const quotedAtMs=Date.parse(quote.quotedAt),expiresAtMs=Date.parse(quote.expiresAt),now=clock.nowMs();
   check(time(now)&&time(quotedAtMs)&&time(expiresAtMs)&&now>=quotedAtMs&&now<expiresAtMs,'quote_expired');
   // Operational receipt UUIDs are not semantic source identities. The complete
   // row still participates in the before/after equality fence below.

   const bindings={contextDigest:await swapPlanContextDigest(row,crypto),bindingDigest:row.binding_digest,inputDigest:row.input_digest,receiptDigest:row.receipt_digest,
    sourceId:row.source_id,sourceRevision:row.source_revision,sourceConfigDigest:row.source_config_digest,policyDigest:e.policyDigest,manifestDigest:row.manifest_digest,
    originalSupplyUnits:row.original_units,activationMs,attMint:market.attMint,ogMint:market.ogMint,poolAddress:market.poolAddress,poolProgram:source.policy.poolProgram,programBinaryDigest:null,accountByteDigests:e.accountByteDigests};
   const plan={kind:'prepared-economic-plan',format:'10x.swap-economic-plan.v1',principal:bound.principal,economicIntentDigest:bound.economicIntentDigest,requestDigest:bound.requestDigest,request:bound.request,quote,bindings,quotedAtMs,expiresAtMs,
    wire:null,wireStatus:'unsupported',unmetEvidence:missing,executable:false,financialExecution:false,serverSigning:false,broadcast:false};
   check(utf8(canonicalJson(plan)).length+80<=SWAP_PLAN_LIMITS.planBytes,'swap_plan_bound');
   const planDigest=await hash(plan),after=await context(parameters.marketId),finished=clock.nowMs();
   if(before.text!==after.text)continue;
   check(time(finished)&&finished>=now&&finished<expiresAtMs,'quote_expired');
   return freeze({...plan,planDigest});
  }return pending('quote_evidence_changed');
  }catch(error){if(error instanceof Hold)return pending(error.message);if(error instanceof QuoteError)return pending(error.code);if(error instanceof SyntaxError)return pending('quote_plan_binding');throw error;}
 }});
}
