const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const failure=(status,code,message,headers)=>json({error:{code,message}},status,headers);
/** Owner-derived read only. No packet, signature or receipt import endpoint. */
export async function handleActionRecovery(request,{repository,authenticate}){
 const path=new URL(request.url).pathname,base='/api/v1/transactions/';if(!path.startsWith(base))return null;
 const principal=await authenticate(request);if(!principal)return failure(401,'authentication_required','Connect your wallet.');
 if(path===base+'prepare'||path.endsWith('/confirm'))return request.method==='POST'?failure(503,'financial_adapter_disabled','Financial preparation and broadcast are disabled in the local release.'):failure(405,'method_not_allowed','Use POST.',{allow:'POST'});
 if(request.method!=='GET')return failure(405,'method_not_allowed','Use GET.',{allow:'GET'});
 let intentId;try{intentId=decodeURIComponent(path.slice(base.length));}catch{return failure(400,'invalid_intent_id','Supply a bounded transaction identifier.');}
 if(!/^[a-zA-Z0-9:_./-]{1,128}$/.test(intentId))return failure(400,'invalid_intent_id','Supply a bounded transaction identifier.');
 const result=await repository.readRecovery(principal,{intentId});
 if(result.kind==='not-found')return failure(404,'not_found','Unknown transaction.');
 if(result.kind==='pending')return json({error:{code:'transaction_history_pending',message:'Retained transaction history requires verification.'},reason:result.reason},503);
 return json({...result.value,attemptId:result.value.currentAttempt?.id??null});
}
