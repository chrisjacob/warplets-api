import {boundedJson,BodyInputError} from '../server/body.mjs';
import {ReviewQueueError as QueueError} from './queue-error.mjs';
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const failure=(status,code,message,headers={})=>json({error:{code,message}},status,headers);
export async function handleReviewQueue(request,{service,authenticate,consumeQuota}){
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/v1\/earn\/submissions\/([A-Za-z0-9._:-]{1,128})\/(review|appeals)$/);
 if(!match)return null;
 const write=match[2]==='appeals',method=write?'POST':'GET';
 if(request.method!==method)return failure(405,'method_not_allowed','Unsupported method.',{allow:method});
 try{
  if(write&&request.headers.get('origin')!==url.origin)return failure(403,'invalid_origin','Use the configured local origin.');
  const principal=await authenticate(request);if(!principal)return failure(401,'authentication_required','Connect your wallet.');
  const quota=await consumeQuota((write?'review-appeal:':'review-feedback:')+principal.wallet,write?5:60);if(quota)return quota;
  if(!write)return json(await service.walletStatus(principal,match[1]));
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return failure(415,'unsupported_media_type','Use application/json.');
  const body=await boundedJson(request,16384);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||!Object.hasOwn(body,'reportId')||!Object.hasOwn(body,'reason'))return failure(400,'invalid_input','Supply reportId and reason only.');
  const result=await service.appeal(principal,{submissionId:match[1],reportId:body.reportId,reason:body.reason,requestKey:request.headers.get('idempotency-key')});
  return json(result.review,result.outcome==='replayed'?200:201,{'x-10x-local-outcome':result.outcome});
 }catch(error){
  if(error instanceof QueueError||error instanceof BodyInputError)return failure(error.status,error.code,error.message);
  throw error;
 }
}
