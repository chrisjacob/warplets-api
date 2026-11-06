import {prepareProgression,progressionState,visualRerollQuote} from '../domain/collections/progression.mjs';
import {checkTimestamp,seasonExpiry,LEVEL_QUOTAS} from '../domain/collections/policy.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
const fail=(condition,code)=>{if(!condition){const error=new TypeError(code);error.code=code;throw error;}};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const units=value=>{fail(typeof value==='string'&&/^(0|[1-9]\d{0,19})$/.test(value)&&BigInt(value)<(1n<<64n),'invalid-local-ceiling');return BigInt(value);};
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function requestBody(value){
 fail(value&&['upgrade','visual'].includes(value.kind)&&id(value.targetId),'invalid-progression-request');
 fail(Object.keys(value).every(key=>['kind','targetId','materialId','expectedTargetVersion','expectedMaterialVersion'].includes(key)),'unexpected-progression-fields');
 fail(Number.isSafeInteger(value.expectedTargetVersion)&&value.expectedTargetVersion>=0,'invalid-target-version');
 if(value.kind==='upgrade')fail(id(value.materialId)&&Number.isSafeInteger(value.expectedMaterialVersion)&&value.expectedMaterialVersion>=0,'invalid-material-version');
 else fail(value.materialId==null&&value.expectedMaterialVersion==null,'unexpected-material');
 return {kind:value.kind,targetId:value.targetId,materialId:value.materialId??null,expectedTargetVersion:value.expectedTargetVersion,expectedMaterialVersion:value.expectedMaterialVersion??null};
}
function sourceContext(value,inventoryId,request){
 fail(value&&value.kind==='season'&&value.seasonId===inventoryId&&Array.isArray(value.assets)&&value.assets.length===(request.kind==='upgrade'?2:1),'wrong-quote-source');
 checkTimestamp(value.start);const expected=new Set([request.targetId,...(request.kind==='upgrade'?[request.materialId]:[])]);
 fail(expected.size===value.assets.length,'identical-upgrade-assets');
 const normalized=progressionState({seasonId:value.seasonId,start:value.start,assets:value.assets});
 const metadata=new Map();
 for(const asset of value.assets){
  fail(expected.has(asset.id)&&asset.inventoryId===inventoryId&&asset.revealStatus==='revealed','unavailable-quote-participant');
  fail(Number.isSafeInteger(asset.version)&&asset.version>=0&&Number.isSafeInteger(asset.rerolls)&&asset.rerolls>=0,'invalid-participant-version');
  fail(Number.isSafeInteger(asset.eligibleAt)&&asset.eligibleAt>=0,'missing-participant-cooldown');
  fail(asset.pending===null||id(asset.pending),'invalid-participant-lock');
  fail(asset.ownerObservedAtMs===null||Number.isSafeInteger(asset.ownerObservedAtMs)&&asset.ownerObservedAtMs>=0,'invalid-owner-observation');
  fail(asset.expiresAt===normalized.assets.find(row=>row.id===asset.id).expiresAt,'participant-expiry-mismatch');
  metadata.set(asset.id,asset);
 }
 const assets=normalized.assets.map(asset=>({...asset,pending:metadata.get(asset.id).pending})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 return {state:{...normalized,assets},participants:assets.map(asset=>({...asset,inventoryId,revealStatus:'revealed',ownerObservedAtMs:metadata.get(asset.id).ownerObservedAtMs}))};
}

/** Pure immutable quote derivation/acceptance planning only. The future repository
 * must supply a genuinely stored quote, fresh facts and atomic authority checks.
 * Accepted command receipts are resolved before calling accept. */
export function createCollectionQuotePlanning({crypto}){
 const hash=value=>crypto.sha256(utf8(canonicalJson(value)));
 async function derive(input){
  const args=structuredClone(input),request=requestBody(args.request);
  fail(args.principal?.kind==='wallet'&&id(args.quoteId)&&id(args.inventoryId)&&id(args.policyVersion),'invalid-quote-identity');decode58(args.principal.wallet,32);
  checkTimestamp(args.nowMs);checkTimestamp(args.expiresMs);fail(args.expiresMs>args.nowMs,'invalid-quote-expiry');
  const {state,participants}=sourceContext(args.context,args.inventoryId,request);
  fail(participants.every(asset=>asset.ownerObservedAtMs===null||asset.ownerObservedAtMs<=args.nowMs),'owner-observation-after-quote');
  const prepared=prepareProgression(state,{...request,operationId:'quote',commitment:'quote',signer:args.principal.wallet,at:args.nowMs}),fee=prepared.operations[0].feeLamports;
  const max=args.maxTotalLamports??fee.toString();fail(units(max)>=fee,'local-ceiling-below-fee');
  const target=state.assets.find(asset=>asset.id===request.targetId);
  const outcomes=request.kind==='upgrade'?{
   targetAfter:{level:target.level+1,expiresAtMs:seasonExpiry(state.start,target.level+1)},
   materialOutcomes:LEVEL_QUOTAS.map((count,index)=>{const expiresAtMs=seasonExpiry(state.start,index+1);return {level:index+1,probabilityNumerator:count,probabilityDenominator:1000,expiresAtMs,remainingMs:Math.max(0,expiresAtMs-args.nowMs)};}),
   historicalAllocationsChange:false,visualTraitsChange:false,
  }:{targetAfter:{level:target.level,expiresAtMs:target.expiresAt},fields:['Model','Backdrop','Symbol'],completedRerolls:target.rerolls,cooldownMs:visualRerollQuote(target.rerolls,args.nowMs).cooldownMs,historicalAllocationsChange:false,visualTraitsChange:true};
  const quote={format:'collection-progression-quote-v1',id:args.quoteId,wallet:args.principal.wallet,kind:request.kind,inventoryId:args.inventoryId,
   targetId:request.targetId,materialId:request.materialId,targetVersion:request.expectedTargetVersion,materialVersion:request.expectedMaterialVersion,policyVersion:args.policyVersion,
   asOfMs:args.nowMs,expiresMs:args.expiresMs,seasonStartMs:state.start,feeLamports:fee.toString(),maxTotalLamports:max,
   costStatus:'local-preview-only',ceilingScope:'disclosed-local-components-only',networkCost:'unknown',totalCost:'unknown',
   costQuote:{payer:'wallet',items:[{kind:'protocol-fee',amountLamports:fee.toString()}],network:{status:'unknown',amountLamports:null}},
   sourceDigest:await hash({seasonId:state.seasonId,start:state.start,participants}),outcomesDigest:await hash(outcomes),outcomes,historicalAllocationsChange:false,executable:false};
  return freeze({...quote,bindingDigest:await hash(quote)});
 }
 async function accept(commandInput,quoteInput,contextInput,optionsInput){
  const command=structuredClone(commandInput),quote=structuredClone(quoteInput),context=structuredClone(contextInput),options=structuredClone(optionsInput);
  fail(command.operationKind==='collection.reserve-operation.v1'&&command.principal?.kind==='wallet','wrong-progression-command');
  const input=command.input;fail(input&&['upgrade','visual'].includes(input.kind),'wrong-progression-kind');
  fail(Object.keys(input).every(key=>['kind','inventoryId','targetId','materialId','expectedTargetVersion','expectedMaterialVersion','quoteId','bindingDigest','policyVersion','reviewedFeeLamports','reviewedMaxTotalLamports','quoteExpiresMs'].includes(key)),'unexpected-progression-acceptance-fields');
  fail(quote?.format==='collection-progression-quote-v1'&&quote.wallet===command.principal.wallet&&quote.id===input.quoteId&&quote.inventoryId===input.inventoryId,'wrong-stored-quote');
  fail(input.bindingDigest===quote.bindingDigest&&input.policyVersion===quote.policyVersion&&options.policyVersion===quote.policyVersion,'quote-policy-or-binding-mismatch');
  fail(input.kind===quote.kind&&input.targetId===quote.targetId&&(input.materialId??null)===quote.materialId&&input.expectedTargetVersion===quote.targetVersion&&(input.expectedMaterialVersion??null)===quote.materialVersion,'quote-participant-binding-mismatch');
  fail(input.reviewedFeeLamports===quote.feeLamports&&input.reviewedMaxTotalLamports===quote.maxTotalLamports&&input.quoteExpiresMs===quote.expiresMs,'quote-reviewed-terms-mismatch');
  checkTimestamp(command.nowMs);fail(command.nowMs>=quote.asOfMs&&command.nowMs<quote.expiresMs,'quote-expired-or-not-yet-valid');
  fail(id(options.operationId)&&id(options.commitment),'invalid-progression-intent');
  const {bindingDigest,...bound}=quote;fail(await hash(bound)===bindingDigest,'stored-quote-digest-mismatch');
  const request={kind:quote.kind,targetId:quote.targetId,materialId:quote.materialId,expectedTargetVersion:quote.targetVersion,expectedMaterialVersion:quote.materialVersion};
  // Remaining lifetime is bound to quote time; re-evaluation must not silently
  // refresh it. Current admission separately uses the actual server clock below.
  const fresh=await derive({quoteId:quote.id,principal:command.principal,inventoryId:quote.inventoryId,request,context,policyVersion:options.policyVersion,nowMs:quote.asOfMs,expiresMs:quote.expiresMs,maxTotalLamports:quote.maxTotalLamports});
  fail(fresh.bindingDigest===quote.bindingDigest,'quote-current-facts-or-outcomes-changed');
  const {state}=sourceContext(context,quote.inventoryId,request);
  const next=prepareProgression(state,{...request,operationId:options.operationId,commitment:options.commitment,signer:command.principal.wallet,at:command.nowMs});
  return freeze({status:'ready',quoteId:quote.id,bindingDigest:quote.bindingDigest,inventoryId:quote.inventoryId,sourceDigest:quote.sourceDigest,
   operation:{...next.operations[0],feeLamports:next.operations[0].feeLamports.toString()},assetWrites:next.assets,
   requiredVersions:{target:quote.targetVersion,material:quote.materialVersion},executable:false});
 }
 return Object.freeze({derive,accept});
}
