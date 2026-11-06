const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff',vary:'Cookie',...headers}});
const fail=(status,code,message)=>json({error:{code,message}},status);
/** Explicit owner-triggered read only; ordinary operation/list paths never call it. */
export async function handleCollectionFairness(request,{repository,authenticate,consumeQuota}){
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/v1\/collect\/me\/operations\/([A-Za-z0-9._:-]{1,128})\/fairness$/);if(!match)return null;
 if(request.method!=='GET')return json({error:{code:'method_not_allowed',message:'Use GET.'}},405,{allow:'GET'});
 const first=await authenticate(request);if(first?.kind!=='wallet')return fail(401,'authentication_required','Sign in to access this resource.');
 if(url.search)return fail(400,'invalid_query','Fairness reads do not accept query parameters.');
 const quota=await consumeQuota('collect-fairness:'+first.wallet,12);if(quota)return quota;
 if(!repository||typeof repository.readOwnFairness!=='function')return fail(503,'fairness_unavailable','Fairness verification is unavailable.');
 const result=await repository.readOwnFairness({principal:first,operationId:match[1]});
 const final=await authenticate(request);if(final?.kind!=='wallet'||final.wallet!==first.wallet)return fail(401,'authentication_required','Sign in again before inspecting private evidence.');
 if(result.kind==='missing')return fail(404,'operation_not_found','Unknown collection operation.');
 if(result.kind==='pending')return fail(503,result.reason,'Retained fairness evidence is unavailable or changed during this read.');
 return json(result.value);
}
