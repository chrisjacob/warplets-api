// Local-only Pages advanced-mode entry. Uses the production Network handlers,
// without compiling or exposing routes belonging to the other apps.
import {onRequestGet as dashboard} from '../../app/functions/api/network/dashboard';
import {onRequestGet as members} from '../../app/functions/api/network/members';
import {onRequestGet as history} from '../../app/functions/api/network/history';
import {applySecurityHeaders} from '../../app/functions/_lib/security';
import {networkHtml,NETWORK_CSP} from '../../app/shared/network/metadata';
import type {NetworkEnv} from '../../app/functions/_lib/network/store';
const routes={'/api/network/dashboard':dashboard,'/api/network/members':members,'/api/network/history':history};
export default {
  async fetch(request:Request<unknown,IncomingRequestCfProperties>,env:NetworkEnv&{ASSETS:Fetcher},ctx:ExecutionContext):Promise<Response>{
    const url=new URL(request.url);
    if(!['GET','HEAD'].includes(request.method)||env.NETWORK_ENABLED!=='true')return new Response('Not found',{status:404});
    const handler=routes[url.pathname as keyof typeof routes];
    if(handler){
      const context:EventContext<NetworkEnv,string,Record<string,unknown>>={request,env,waitUntil:ctx.waitUntil.bind(ctx),functionPath:url.pathname,params:{},data:{},passThroughOnException:ctx.passThroughOnException.bind(ctx),next:(input=request,init)=>env.ASSETS.fetch(input,init)};
      const response=await handler(context);
      return request.method==='HEAD'?new Response(null,response):response;
    }
    if(url.pathname.startsWith('/api/'))return new Response('Not found',{status:404});
    const response=await env.ASSETS.fetch(request);
    if(!response.headers.get('content-type')?.includes('text/html'))return applySecurityHeaders(response);
    const headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');headers.set('x-robots-tag','noindex, nofollow');
    const origin=request.headers.get('x-10x-public-origin')==='https://network-local.10x.meme'?'https://network-local.10x.meme':url.origin;
    return applySecurityHeaders(new Response(networkHtml(await response.text(),origin,url.pathname),{status:response.status,headers}),{csp:NETWORK_CSP});
  }
};
