import {boundedJson,BodyInputError} from '../server/body.mjs';
import {QuoteError,requireQuote} from './math.mjs';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const failure=(status,code,message,headers={})=>json({error:{code,message}},status,headers);
/** Shared read-only quote transport. Composition supplies real evidence ports. */
export async function handleInteractiveQuotes(request,{service,consumeQuota,peer}){
 const {pathname,search,origin}=new URL(request.url),status=/^\/api\/v1\/markets\/([a-z0-9][a-z0-9-]{0,63})\/quote-status$/.exec(pathname);
 if(!status&&pathname!=='/api/v1/quotes')return null;
 const method=status?'GET':'POST';if(request.method!==method)return failure(405,'method_not_allowed','Use '+method+'.',{allow:method});
 try{
  requireQuote(!search,'invalid_query','Quote endpoints do not accept query parameters.',400);
  const quota=await consumeQuota('quote:'+peer,status?60:20);if(quota)return quota;
  if(status)return json(await service.availability(status[1]));
  requireQuote(request.headers.get('origin')===origin,'invalid_origin','Use the local origin.',403);
  requireQuote(request.headers.get('content-type')?.split(';')[0]==='application/json','unsupported_media_type','Use application/json.',415);
  const input=await boundedJson(request,2048);
  requireQuote(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===4&&['marketId','direction','inputUnits','slippageBps'].every(k=>Object.hasOwn(input,k))&&typeof input.marketId==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.marketId),'invalid_request','Provide marketId, direction, inputUnits and slippageBps.',400);
  return json(await service.quote(input));
 }catch(error){if(error instanceof QuoteError||error instanceof BodyInputError)return failure(error.status,error.code,error.message);throw error;}
}
