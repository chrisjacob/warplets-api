import {boundedJson,BodyInputError} from '../server/body.mjs';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const failure=(status,code,message)=>json({error:{code,message}},status);
/** Shared member fixture transport; composition must supply guarded normalized admission. */
export async function handleMintReservation(request,{reservations,authenticate,consumeQuota}){
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/v1\/collect\/inventories\/([A-Za-z0-9._:-]{1,128})\/stages\/([A-Za-z0-9._:-]{1,128})\/reservations$/);
 if(!match)return null;
 if(request.method!=='POST')return json({error:{code:'method_not_allowed',message:'Use POST.'}},405,{allow:'POST'});
 if(url.search)return failure(400,'invalid_query','Reservation requests do not accept query parameters.');
 if(request.headers.get('origin')!==url.origin)return failure(403,'invalid_origin','Use the configured local origin.');
 const principal=await authenticate(request);if(!principal)return failure(401,'authentication_required','Sign in to reserve a local fixture slot.');
 if(principal.kind!=='wallet')return failure(403,'wallet_session_required','A wallet session is required.');
 const quota=await consumeQuota('collect-write:'+principal.wallet,15);if(quota)return quota;
 const requestKey=request.headers.get('idempotency-key');if(typeof requestKey!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(requestKey))return failure(400,'invalid_request_key','Supply an Idempotency-Key for this request.');
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return failure(415,'unsupported_media_type','Use application/json.');
 try{
  const body=await boundedJson(request,4096);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||typeof body.expectedTermsDigest!=='string'||!/^[a-f0-9]{64}$/.test(body.expectedTermsDigest))return failure(400,'invalid_input','Supply the exact published terms digest reviewed for this stage.');
  const result=await reservations.reserveMint(principal,{requestKey,inventoryId:match[1],stageId:match[2],expectedTermsDigest:body.expectedTermsDigest});
  if(result.kind==='conflict')return failure(409,result.code,'The reservation conflicts with current state or an earlier request.');
  if(result.kind==='pending'){const denied=result.reason==='wallet_ineligible',changed=['stage_unavailable','stage_wallet_limit','sold_out','mint-command-binding','mint-window-expired'].includes(result.reason);return failure(denied?403:changed?409:503,result.reason,denied?'This wallet is not eligible for the fixed stage list.':changed?'The reviewed stage or remaining allowance is no longer available.':'New reservations are held until the required local evidence and operating state are available.');}
  if(!['committed','replayed'].includes(result.kind))throw new TypeError('Unexpected mint reservation outcome.');
  const v=result.value,operation={id:v.operationId,kind:'mint',inventoryId:v.inventoryId,owner:v.wallet,stageId:v.stageId,termsDigest:v.termsDigest,targetId:null,materialId:null,status:v.status,createdAt:new Date(v.createdMs).toISOString(),priceLamports:v.priceLamports,costLamports:v.costLamports,feeLamports:null,assetId:null,fairness:v.fairness,source:'local-fixture',executable:false};
  return json({operation,replayed:result.kind==='replayed'},result.kind==='replayed'?200:201);
 }catch(error){if(error instanceof BodyInputError)return failure(error.status,error.code,error.message);throw error;}
}
