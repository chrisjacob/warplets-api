import { z } from 'zod';
import { createClient, PlatformApiError } from '../../contracts/client.mjs';

const inventory = z.object({
  version:z.literal(1),mode:z.literal('local-validation'),
  runtime:z.enum(['node-reference','workerd-local']),
  apiBase:z.literal('/api/v1'),featureScope:z.literal('listed-routes-only'),
  features:z.array(z.object({id:z.string().max(100),status:z.literal('local-validation'),
    routes:z.array(z.object({method:z.enum(['GET','POST']),path:z.string().max(256)
      .regex(/^\/api\/v1\//)})).max(100)})).max(100),
  production:z.object({financialExecution:z.literal(false),serverSigning:z.literal(false),
    broadcast:z.literal(false),deposits:z.literal(false),claimExecution:z.literal(false)}),
  walletAuthentication:z.literal('message-only'),externalNotifications:z.literal(false),
});
const unavailable = message => new PlatformApiError(503,{code:'runtime_unavailable',message,retryable:false});
function matches(template,path) {
  const expected=template.split('/'),actual=path.split('/');
  return expected.length===actual.length && expected.every((part,index)=>
    /^\{[a-zA-Z][a-zA-Z0-9]*\}$/.test(part)?actual[index].length>0:part===actual[index]);
}

// Per-client cache: neither personalized state nor inventories cross API origins.
export function capabilityTransport({fetchImpl=globalThis.fetch,baseUrl='/api/v1',
  now=()=>Date.now(),ttlMs=30000,timeoutMs=5000}={}) {
  const raw=createClient({fetchImpl,baseUrl});
  let pending,expires=0;
  async function discover() {
    if(!pending || now()>=expires) {
      expires=now()+ttlMs;
      pending=raw.getCapabilities({signal:AbortSignal.timeout(timeoutMs)}).then(result=>inventory.parse(result.data));
    }
    try {return await pending;}
    catch {throw unavailable('Runtime capabilities are unavailable. Retry shortly to refresh support.');}
  }
  const transport=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,'http://local.invalid');
    const method=(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
    // Public discovery remains readable even when capability discovery fails.
    const publicDiscovery=method==='GET' && ['/api/v1/capabilities','/api/v1/policy','/api/v1/collections','/api/v1/health','/api/v1/openapi.json'].includes(url.pathname);
    if(!publicDiscovery) {
      const capabilities=await discover();
      init?.signal?.throwIfAborted();
      if(!capabilities.features.some(feature=>feature.routes.some(route=>route.method===method && matches(route.path,url.pathname))))
        throw unavailable('This feature is unavailable in the connected runtime.');
    }
    return fetchImpl(input,init);
  };
  return {fetch:transport,discover,clear:()=>{pending=undefined;expires=0;}};
}
