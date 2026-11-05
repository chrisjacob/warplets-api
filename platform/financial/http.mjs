import {FinancialReadError} from './cursor.mjs';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const failure=(status,code,message,headers={})=>json({error:{code,message}},status,headers);
export async function handleFinancialReads(request,{service,authenticate}){
 const {pathname,searchParams}=new URL(request.url),asset=/^\/api\/v1\/nfts\/([A-Za-z0-9._:-]{1,128})\/vault$/.exec(pathname),farm=/^\/api\/v1\/farms\/([a-z0-9-]{1,64})$/.exec(pathname),member=pathname==='/api/v1/vault',positions=pathname==='/api/v1/stake/positions';
 if(!asset&&!farm&&!member&&!positions)return null;
 if(request.method!=='GET')return failure(405,'method_not_allowed','Use GET.',{allow:'GET'});
 if([...searchParams.keys()].some(k=>k!=='cursor'||searchParams.getAll(k).length!==1)||farm&&searchParams.size)return failure(400,'invalid_query','Unsupported financial read query.');
 try{
  const cursor=searchParams.get('cursor')??undefined;
  if(asset)return json(await service.readAssetVault(asset[1],{cursor}));
  if(farm)return json(await service.readFarm(farm[1]));
  const principal=await authenticate(request);if(!principal)return failure(401,'authentication_required','Connect your wallet.');
  return json(member?await service.readMemberVault(principal,{cursor}):await service.readPositions(principal,{cursor}));
 }catch(error){
  if(error instanceof FinancialReadError||error?.code==='read_byte_bound')return failure(error.status,error.code,error.message);
  throw error;
 }
}
