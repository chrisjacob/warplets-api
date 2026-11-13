const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
export async function handlePerformance(request,{service,authenticate=async()=>null}={}){
 const url=new URL(request.url),prefix='/api/v1/performance/';if(!url.pathname.startsWith(prefix))return null;
 if(request.method!=='GET')return response({error:{code:'method_not_allowed',message:'Performance views are read-only.'}},405);
 if(!service)return response({error:{code:'performance_unavailable',message:'Performance valuations are unavailable until a reviewed data source is connected.'}},503);
 try{
  if(url.pathname===prefix+'activity'){if([...url.searchParams.keys()].some(k=>k!=='limit'))throw Error();return response(service.activity(Number(url.searchParams.get('limit')??5)));}
  const board=/^boards\/(tokens|nfts|airdrops|stake|earn)$/.exec(url.pathname.slice(prefix.length));
  if(board){
   if([...url.searchParams.keys()].some(k=>!['mode','limit'].includes(k)))throw Error();
   const anonymous=request.headers.get('x-tenx-public-read');if(anonymous!==null&&anonymous!=='1')throw Error();
   // Public query caches must never receive viewer personalization, even when a
   // browser/proxy forwards a cookie despite the client's credentials setting.
   const mode=url.searchParams.get('mode')??'peak',limit=Number(url.searchParams.get('limit')??100),principal=anonymous==='1'?null:await authenticate(request);
   return response(service.board(board[1],{mode,limit,wallet:principal?.wallet??null}));
  }
  const profile=/^profiles\/([A-Za-z0-9._:-]{1,128})$/.exec(url.pathname.slice(prefix.length));
  if(profile){if([...url.searchParams.keys()].some(k=>!['cursor','limit'].includes(k)))throw Error();const result=service.profile(profile[1],{cursor:Number(url.searchParams.get('cursor')??0),limit:Number(url.searchParams.get('limit')??20)});return result?response(result):response({error:{code:'profile_not_found',message:'Participant not found.'}},404);}
  return response({error:{code:'not_found',message:'Performance view not found.'}},404);
 }catch{return response({error:{code:'invalid_performance_request',message:'Invalid performance request.'}},400);}
}
