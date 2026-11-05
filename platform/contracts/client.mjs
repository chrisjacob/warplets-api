import {operations} from './operations.mjs';

export class PlatformApiError extends Error {
  constructor(status,details) {
    super(details.message??'The request failed.');
    this.status=status;this.code=details.code??'invalid_response';
    this.requestId=details.requestId;this.retryable=details.retryable??false;
  }
}
export function createClient({baseUrl='/api/v1',fetchImpl=globalThis.fetch}={}) {
  const root=baseUrl.replace(/\/$/,'');
  return Object.fromEntries(operations.map(({id,method,path})=>[id,async(options={})=>{
    const pathname=path.replace(/{([^}]+)}/g,(_,name)=>{
      const value=options.path?.[name];
      if(typeof value!=='string'||!value||value==='.'||value==='..')throw new TypeError('Missing or unsafe path parameter '+name);
      return encodeURIComponent(value);
    });
    const params=new URLSearchParams();
    for(const [key,val] of Object.entries(options.query??{}))if(val!==undefined)params.set(key,String(val));
    const headers=new Headers(options.headers);
    headers.set('accept','application/vnd.10x.v1+json');
    if(options.idempotencyKey)headers.set('Idempotency-Key',options.idempotencyKey);
    const init={method,headers,credentials:'same-origin',signal:options.signal};
    if(options.body!==undefined){headers.set('content-type','application/json');init.body=JSON.stringify(options.body);}
    const response=await fetchImpl(root+pathname+(params.size?'?'+params:''),init);
    let data;
    try {data=await response.json();}
    catch {
      throw new PlatformApiError(response.ok?502:response.status,{code:'invalid_response',
        message:'The API returned an unreadable response.',requestId:response.headers.get('x-request-id'),
        retryable:response.status===429||response.status>=500});
    }
    if(!response.ok)throw new PlatformApiError(response.status,data?.error??{requestId:response.headers.get('x-request-id')});
    return data;
  }]));
}
