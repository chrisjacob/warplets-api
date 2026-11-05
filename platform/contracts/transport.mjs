import {policy} from './policy.mjs';
export const mediaType='application/vnd.10x.v1+json';
const stableCache=new Set(['/api/v1/policy','/api/v1/launch/fee-schedule','/api/v1/openapi.json']);
export async function represent(request,response,now) {
 const pathname=new URL(request.url).pathname;
 if(!pathname.startsWith('/api/v1/')||!response.headers.get('content-type')?.includes('application/json'))return response;
 const headers=new Headers(response.headers),requestId=headers.get('x-request-id')??crypto.randomUUID();
 headers.set('x-request-id',requestId);
 const wrap=pathname!=='/api/v1/openapi.json'&&request.headers.get('accept')?.split(',').some(x=>x.split(';')[0].trim()===mediaType);
 const original=await response.json();
 const stable=stableCache.has(pathname)&&response.status===200;
 const meta={requestId,policyVersion:policy.version,asOf:original.asOf??new Date(now).toISOString(),sourceSlot:null};
 let result=original;
 if(original.error){
  const retryAfter=headers.get('retry-after');
  result={error:{...original.error,retryable:response.status===429||response.status>=500,requestId,...(retryAfter?{retryAfter:Number(retryAfter)}:{})}};
 } else if(wrap){
  result=Array.isArray(original.items)?{...original,snapshotId:original.snapshotId??meta.asOf,meta}:{data:original,meta};
 }
 headers.set('vary','Accept');
 if(wrap)headers.set('content-type',mediaType+'; charset=utf-8');
 if(stable){
  // Weak validator covers the resource and format, independent of per-request meta.
  const hashed=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(original)+(wrap?'wrapped':'plain')));
  const tag='W/"'+Array.from(new Uint8Array(hashed).slice(0,16),n=>n.toString(16).padStart(2,'0')).join('')+'"';
  headers.set('etag',tag);headers.set('cache-control','public, max-age=0, must-revalidate');
  const validators=request.headers.get('if-none-match')?.split(',').map(s=>s.trim())??[];
  if(validators.includes(tag)||validators.includes('*'))return new Response(null,{status:304,headers});
 }
 return new Response(JSON.stringify(result),{status:response.status,headers});
}
