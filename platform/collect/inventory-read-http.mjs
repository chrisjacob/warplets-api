const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const failure=(status,code,message)=>json({error:{code,message}},status);
export async function handleInventoryReads(request,{reads,authenticate,consumeQuota,clock}){
 const url=new URL(request.url),item=url.pathname.match(/^\/api\/v1\/collect\/inventories\/([A-Za-z0-9._:-]{1,128})$/),list=url.pathname==='/api/v1/collect/inventories';
 if(!item&&!list)return null;if(request.method!=='GET')return json({error:{code:'method_not_allowed',message:'Use GET.'}},405,{allow:'GET'});
 const after=url.searchParams.get('cursor')??'';
 if([...url.searchParams.keys()].some(key=>key!=='cursor')||url.searchParams.getAll('cursor').length>1||after&&!/^[A-Za-z0-9._:-]{1,128}$/.test(after)||item&&after)return failure(400,'invalid_cursor','Invalid inventory cursor.');
 const principal=await authenticate(request);if(principal){const limited=await consumeQuota('collect-inventory:'+principal.wallet,60);if(limited)return limited;}
 const q={nowMs:clock.nowMs(),principal},result=item?await reads.readInventory({...q,inventoryId:item[1]}):await reads.listInventories({...q,after});
 if(result.kind==='missing')return failure(404,'collection_not_found','Unknown collection inventory.');
 if(result.kind==='pending')return failure(503,result.reason,'Collection inventory evidence is unavailable or changed during this read.');
 return json(result.value);
}
