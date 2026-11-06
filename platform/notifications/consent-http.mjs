import {normalizeNotificationConsentInput,NOTICE_TERMS,NOTICE_TOPICS} from './consent.mjs';
import {EarnError} from '../earn/validation.mjs';
import {boundedJson,BodyInputError} from '../server/body.mjs';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const failure=(status,code,message,headers={})=>json({error:{code,message}},status,headers);
export const portableNoticeCapabilities=Object.freeze({channel:'local-inbox',topics:NOTICE_TOPICS,terms:NOTICE_TERMS,delivery:'in-app fixture only',externalTransport:false,dailyLimit:3});
/** Portable private consent boundary. No enqueue, recipient or delivery input. */
export async function handleNotificationConsent(request,{service,authenticate,consumeQuota,capabilities=portableNoticeCapabilities}){
 const url=new URL(request.url),path=url.pathname,base='/api/v1/notifications';
 const caps=path===base+'/capabilities',subscriptions=path===base+'/subscriptions';
 if(!caps&&!subscriptions)return null;
 const methods=caps?['GET']:['GET','POST'];
 if(!methods.includes(request.method))return failure(405,'method_not_allowed','Unsupported method.',{allow:methods.join(', ')});
 if(caps)return json(capabilities);
 if(request.method==='POST'&&request.headers.get('origin')!==url.origin)return failure(403,'invalid_origin','Use the configured local origin.');
 try{
  const principal=await authenticate(request);if(!principal)return failure(401,'authentication_required','Connect your wallet.');
  const quota=await consumeQuota('notice:'+request.method+':'+principal.wallet,request.method==='POST'?10:60);if(quota)return quota;
  if(request.method==='GET')return json(await service.readPreferences(principal));
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return failure(415,'unsupported_media_type','Use application/json.');
  const body=await boundedJson(request,2048),requestKey=request.headers.get('idempotency-key');
  if(!requestKey||!/^[A-Za-z0-9._:-]{1,128}$/.test(requestKey))return failure(400,'invalid_input','Use a scoped Idempotency-Key.');
  let input;try{input=normalizeNotificationConsentInput(body);}catch{return failure(400,'invalid_input','Supply exact local inbox consent fields.');}
  const result=await service.setConsent(principal,{requestKey,input});
  if(result.kind==='conflict')return failure(409,result.code,'Refresh your preferences or recover the original request.');
  if(result.kind==='pending')return json(result,202);
  return json(result);
 }catch(error){
  if(error instanceof EarnError||error instanceof BodyInputError)return failure(error.status,error.code,error.message);
  throw error;
 }
}
