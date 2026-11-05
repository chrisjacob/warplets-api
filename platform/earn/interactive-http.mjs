import {EarnError} from './validation.mjs';
import {boundedJson,BodyInputError} from '../server/body.mjs';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const failure=(status,code,message,headers={})=>json({error:{code,message}},status,headers);
export async function handleInteractiveEarn(request,{service,authenticate,consumeQuota,peer}){
 const url=new URL(request.url),path=url.pathname,base='/api/v1/earn';
 const board=path.match(/^\/api\/v1\/earn\/epochs\/([^/]+)\/leaderboard$/),completion=path.match(/^\/api\/v1\/earn\/actions\/([A-Za-z0-9._:-]{1,128})\/completions$/);
 const post=path===base+'/submissions',me=path===base+'/me',claims=path===base+'/claims',actions=path===base+'/actions',capacity=path===base+'/capacity';
 if(!board&&!completion&&!post&&!me&&!claims&&!actions&&!capacity)return null;
 const write=!!(post||completion),method=write?'POST':'GET';
 if(request.method!==method)return failure(405,'method_not_allowed','Unsupported method.',{allow:method});
 try{
  if(board||actions||capacity){
   const quota=await consumeQuota('earn-read:'+peer,60);if(quota)return quota;
   if(board){
    const date=board[1],ms=Date.parse(date+'T00:00:00.000Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(ms)||ms<0||new Date(ms).toISOString().slice(0,10)!==date)return failure(400,'invalid_epoch','Use a UTC YYYY-MM-DD date.');
    return json(await service.readLeaderboard(ms/86400000));
   }
   return json(capacity?await service.readCapacity():await service.readActions());
  }
  if(write&&request.headers.get('origin')!==url.origin)return failure(403,'invalid_origin','Use the configured local origin.');
  const principal=await authenticate(request);if(!principal)return failure(401,'authentication_required','Connect your wallet.');
  const quota=await consumeQuota((write?'earn-submit:':'earn-wallet-read:')+principal.wallet,write?10:60);if(quota)return quota;
  if(write){
   if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return failure(415,'unsupported_media_type','Use application/json.');
   const body=await boundedJson(request);
   if(completion){
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==2||!Object.hasOwn(body,'proof')||!Object.hasOwn(body,'signature'))return failure(400,'invalid_input','Supply proof and signature only.');
    return json(await service.acceptSignedCompletion(principal,{actionId:completion[1],proof:body.proof,signature:body.signature}));
   }
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['tokenId','url'].includes(k)))return failure(400,'invalid_input','Supply only tokenId and url.');
   const result=await service.submitContent(principal,{tokenId:body.tokenId,url:body.url,requestKey:request.headers.get('idempotency-key')});
   return json({mode:'local-fixture',...result.submission},result.replay?200:201);
  }
  const cursor=url.searchParams.get('cursor')??'0';if(!/^\d{1,15}$/.test(cursor))return failure(400,'invalid_cursor','Invalid cursor.');
  return json(claims?await service.readWalletClaims(principal,{after:Number(cursor)}):await service.readWalletSubmissions(principal,{after:Number(cursor)}));
 }catch(error){
  if(error instanceof EarnError||error instanceof BodyInputError)return failure(error.status,error.code,error.message);
  throw error;
 }
}
