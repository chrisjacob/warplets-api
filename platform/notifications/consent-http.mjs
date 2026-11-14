import {normalizeNotificationConsentInput,NOTICE_TERMS,NOTICE_TOPICS} from './consent.mjs';
import {EarnError} from '../earn/validation.mjs';
import {boundedJson,BodyInputError} from '../server/body.mjs';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const failure=(status,code,message,headers={})=>json({error:{code,message}},status,headers);
export const portableNoticeCapabilities=Object.freeze({channel:'local-inbox',topics:Object.freeze(NOTICE_TOPICS.filter(topic=>topic!=='voting')),terms:NOTICE_TERMS,delivery:'in-app fixture only',externalTransport:false,dailyLimit:3});
/** Portable private consent boundary. No enqueue, recipient or delivery input. */
export async function handleNotificationConsent(request,{service,authenticate,consumeQuota,readInbox,capabilities=portableNoticeCapabilities}){
 const url=new URL(request.url),path=url.pathname,base='/api/v1/notifications';
 const caps=path===base+'/capabilities',subscriptions=path===base+'/subscriptions',inbox=path===base+'/inbox'&&typeof readInbox==='function';
 if(!caps&&!subscriptions&&!inbox)return null;
 const methods=caps||inbox?['GET']:['GET','POST'];
 if(!methods.includes(request.method))return failure(405,'method_not_allowed','Unsupported method.',{allow:methods.join(', ')});
 if(caps)return json(capabilities);
 if(request.method==='POST'&&request.headers.get('origin')!==url.origin)return failure(403,'invalid_origin','Use the configured local origin.');
 try{
  const principal=await authenticate(request);if(!principal)return failure(401,'authentication_required','Connect your wallet.');
  const quota=await consumeQuota('notice:'+request.method+':'+principal.wallet,request.method==='POST'?10:60);if(quota)return quota;
  if(inbox){const cursor=url.searchParams.get('cursor');if(cursor!==null&&!/^(\d{1,16})\.([a-f0-9]{64})$/.test(cursor))return failure(400,'invalid_cursor','Invalid inbox cursor.');return json(await readInbox(principal,{cursor,limit:25}));}
  if(request.method==='GET')return json(await service.readPreferences(principal));
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return failure(415,'unsupported_media_type','Use application/json.');
  const body=await boundedJson(request,2048),requestKey=request.headers.get('idempotency-key');
  if(!requestKey||!/^[A-Za-z0-9._:-]{1,128}$/.test(requestKey))return failure(400,'invalid_input','Use a scoped Idempotency-Key.');
  let input;try{input=normalizeNotificationConsentInput(body);}catch{return failure(400,'invalid_input','Supply exact local inbox consent fields.');}
  const result=await service.setConsent(principal,{requestKey,input});
  if(result.kind==='conflict')return failure(409,result.code,'Refresh your preferences or recover the original request.');
  if(result.kind==='pending')return json(result,202);
  return json(result,200,{'x-10x-local-outcome':result.replay?'replayed':'accepted'});
 }catch(error){
  if(error instanceof EarnError||error instanceof BodyInputError)return failure(error.status,error.code,error.message);
  throw error;
 }
}
