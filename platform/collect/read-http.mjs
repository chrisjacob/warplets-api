const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const failure=(status,code,message)=>json({error:{code,message}},status);
/** Only four bounded read routes. Inventory/stage authority is deliberately not
 * inferred from asset availability or enabled by this handler. */
export async function handleCollectionReads(request,{reads,authenticate,consumeQuota,clock}){
 const url=new URL(request.url),asset=url.pathname.match(/^\/api\/v1\/collect\/assets\/([A-Za-z0-9._:-]{1,128})$/),operation=url.pathname.match(/^\/api\/v1\/collect\/me\/operations\/([A-Za-z0-9._:-]{1,128})$/),assets=url.pathname==='/api/v1/collect/me/assets',operations=url.pathname==='/api/v1/collect/me/operations';
 if(!asset&&!operation&&!assets&&!operations)return null;
 if(request.method!=='GET')return json({error:{code:'method_not_allowed',message:'Use GET.'}},405,{allow:'GET'});
 const principal=asset?null:await authenticate(request);if(!asset&&!principal)return failure(401,'authentication_required','Sign in to access this resource.');
 if([...url.searchParams.keys()].some(key=>key!=='cursor')||url.searchParams.getAll('cursor').length>1)return failure(400,'invalid_cursor','Only a single cursor is accepted.');
 const after=url.searchParams.get('cursor')??'';if(after&&!/^[A-Za-z0-9._:-]{1,128}$/.test(after)||(asset||operation)&&after)return failure(400,'invalid_cursor','Invalid resource cursor.');
 if(principal){const quota=await consumeQuota('collect-owner:'+principal.wallet,60);if(quota)return quota;}
 const nowMs=clock.nowMs(),result=asset?await reads.readAsset({assetId:asset[1],nowMs}):operation?await reads.readOwnOperation({principal,operationId:operation[1],nowMs}):await reads[assets?'listOwnedAssets':'listOwnOperations']({principal,after,nowMs});
 if(result.kind==='missing')return failure(404,asset?'asset_not_found':'operation_not_found','Unknown collection resource.');
 if(result.kind==='pending')return failure(503,result.reason,'Collection evidence is unavailable or changed during this read.');
 return json(result.value);
}
