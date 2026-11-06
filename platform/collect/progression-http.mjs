import {boundedJson,BodyInputError} from '../server/body.mjs';
import {CollectionQuoteInputError,normalizeCollectionQuoteInput} from './quote-service.mjs';
import {normalizeProgressionReservation} from './reservation-service.mjs';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const failure=(status,code,message)=>json({error:{code,message}},status);
const iso=ms=>new Date(ms).toISOString();

/** Stable display fields plus the exact terms required by reservation. The
 * projection never refreshes an original quote's time, outcome or ceiling. */
export function storedProgressionQuoteView(q){
 const common={kind:q.kind,inventoryId:q.inventoryId,targetId:q.targetId,materialId:q.materialId,feeLamports:q.feeLamports,
  quoteId:q.id,bindingDigest:q.bindingDigest,policyVersion:q.policyVersion,targetVersion:q.targetVersion,materialVersion:q.materialVersion,
  maxTotalLamports:q.maxTotalLamports,quoteExpiresMs:q.expiresMs,expiresAt:iso(q.expiresMs),asOf:iso(q.asOfMs),
  costStatus:q.costStatus,ceilingScope:q.ceilingScope,networkCost:q.networkCost,totalCost:q.totalCost,
  historicalAllocationsChange:false,source:'local-fixture',executable:false};
 return {...common,...(q.kind==='upgrade'?{nextTargetLevel:q.outcomes.targetAfter.level,nextTargetExpiry:iso(q.outcomes.targetAfter.expiresAtMs),
  materialProbabilities:q.outcomes.materialOutcomes.map(row=>({level:row.level,count:row.probabilityNumerator,total:row.probabilityDenominator,expiresAt:iso(row.expiresAtMs),remainingMs:row.remainingMs}))}
  :{level:q.outcomes.targetAfter.level,cooldownMs:q.outcomes.cooldownMs,fields:q.outcomes.fields})};
}
export function progressionReservationView(value){return {
 id:value.operationId,kind:value.kind,inventoryId:value.inventoryId,owner:value.wallet,stageId:null,targetId:value.targetId,materialId:value.materialId,
 status:value.status,createdAt:null,priceLamports:null,costLamports:null,feeLamports:value.feeLamports,assetId:null,
 quoteId:value.quoteId,bindingDigest:value.bindingDigest,fairness:value.fairness,source:'local-fixture',executable:false,
};}
function outcomeFailure(result){
 if(result.kind==='conflict')return failure(409,result.code,'The request conflicts with current state or an earlier request.');
 const reason=result.reason;
 if(reason==='stored-quote-missing')return failure(404,reason,'The quote is unavailable for this wallet.');
 const reviewed=['quote-expired-or-not-yet-valid','quote-expired-before-reservation','quote-expired-before-storage','quote-current-facts-or-outcomes-changed','quote-policy-or-binding-mismatch','quote-participant-binding-mismatch','quote-reviewed-terms-mismatch','wrong_owner','stale_asset_version','asset_reserved','reroll_cooldown','ineligible_upgrade_level','owner-changed','asset-version-changed','asset-reserved'].includes(reason);
 return failure(reviewed?409:503,reason,reviewed?'The reviewed quote or asset state is no longer valid.':'New reservations are held until the required local evidence or operating state is available.');
}
/** Shared member transport. Composition mounts this only with the tested quote
 * issuer and quote-required reservation adapter; it has no legacy fallback. */
export async function handleProgression(request,{quotes,reservations,authenticate,consumeQuota}){
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/v1\/collect\/inventories\/([A-Za-z0-9._:-]{1,128})\/progression(\/quote)?$/);
 if(!match)return null;
 if(request.method!=='POST')return json({error:{code:'method_not_allowed',message:'Use POST.'}},405,{allow:'POST'});
 if(url.search)return failure(400,'invalid_query','Progression requests do not accept query parameters.');
 if(request.headers.get('origin')!==url.origin)return failure(403,'invalid_origin','Use the configured local origin.');
 const principal=await authenticate(request);if(!principal)return failure(401,'authentication_required','Sign in to review or reserve local progression.');
 const quota=await consumeQuota('collect-write:'+principal.wallet,15);if(quota)return quota;
 const key=request.headers.get('idempotency-key');if(typeof key!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(key))return failure(400,'invalid_request_key','Supply an Idempotency-Key for this request.');
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return failure(415,'unsupported_media_type','Use application/json.');
 try{
  const body=await boundedJson(request,4096);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.hasOwn(body,'inventoryId')||Object.hasOwn(body,'requestKey'))return failure(400,'invalid_input','The collection and request identity come from the route and header.');
  let input;
  try{input=(match[2]?normalizeCollectionQuoteInput:normalizeProgressionReservation)({...body,inventoryId:match[1]});}
  catch(error){if(error instanceof TypeError)return failure(400,error.code??'invalid_input','Supply valid bounded progression terms.');throw error;}
  const result=match[2]?await quotes.issueQuote(principal,{...input,requestKey:key}):await reservations.reserve(principal,{...input,requestKey:key});
  if(!['committed','replayed'].includes(result.kind))return outcomeFailure(result);
  return match[2]?json(storedProgressionQuoteView(result.value)):json({operation:progressionReservationView(result.value),replayed:result.kind==='replayed'},result.kind==='replayed'?200:201);
 }catch(error){if(error instanceof CollectionQuoteInputError||error instanceof BodyInputError)return failure(error.status,error.code,error.message);throw error;}
}
