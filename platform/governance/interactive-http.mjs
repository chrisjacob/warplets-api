import {GovernanceError} from '../application/governance-service.mjs';
import {boundedJson,BodyInputError} from '../server/body.mjs';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const failure=(status,code,message,headers={})=>json({error:{code,message}},status,headers);
export async function handleInteractiveGovernance(request,{service,authenticate,consumeQuota,peer}){
 const url=new URL(request.url),base='/api/v1/genesis/ballots';if(url.pathname!==base&&!url.pathname.startsWith(base+'/'))return null;
 const list=url.pathname===base,match=url.pathname.match(/^\/api\/v1\/genesis\/ballots\/([a-z0-9][a-z0-9-]{0,63})(\/votes)?$/);
 if(!list&&!match)return failure(404,'not_found','Unknown ballot resource.');
 const write=!!match?.[2],method=write?'POST':'GET';if(request.method!==method)return failure(405,'method_not_allowed','Unsupported method.',{allow:method});
 if(url.search)return failure(400,'invalid_query','Ballot routes do not accept query parameters.');
 try{
  if(!write){const quota=await consumeQuota('governance-read:'+peer,60);if(quota)return quota;return json(list?await service.listBallots():await service.readBallot(match[1]));}
  if(request.headers.get('origin')!==url.origin)return failure(403,'invalid_origin','Use the configured local origin.');
  const principal=await authenticate(request);if(!principal)return failure(401,'authentication_required','Connect your wallet.');
  const quota=await consumeQuota('votes:'+principal.wallet,12);if(quota)return quota;
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return failure(415,'unsupported_media_type','Use application/json.');
  const input=await boundedJson(request,4096);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||!Object.hasOwn(input,'choice'))return failure(400,'invalid_input','Supply only the ballot choice.');
  const result=await service.castVote(principal,{ballotId:match[1],choice:input.choice});return json(result,result.replayed?200:201);
 }catch(error){if(error instanceof GovernanceError||error instanceof BodyInputError)return failure(error.status,error.code,error.message);throw error;}
}
