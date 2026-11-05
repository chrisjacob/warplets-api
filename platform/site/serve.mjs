import { readFile } from 'node:fs/promises';

const routes=new Set(['/','/markets','/vault','/stake','/earn','/collect']);
const assetPattern=/^\/site-assets\/([A-Za-z0-9_-]+\.(js|css))$/;
const types={html:'text/html',css:'text/css',js:'text/javascript'};

/** Serve the explicitly built local frontend. An absent build returns null so a
 * host can use the reference viewer while installing offline dependencies. No
 * deployment hook, web tunnel or external asset serving is configured here.
 */
export async function serveSite(request, dist=new URL('./dist/',import.meta.url)){
  const path=new URL(request.url).pathname, asset=assetPattern.exec(path);
  if(!routes.has(path)&&!asset)return null;
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',
    {status:405,headers:{Allow:'GET, HEAD'}});
  const url=asset?new URL('site-assets/'+asset[1],dist):new URL('index.html',dist);
  let bytes;
  try {bytes=await readFile(url);}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    if(!asset)return null;
    return new Response('Asset not found',{status:404,headers:{'cache-control':'no-store'}});
  }
  return new Response(request.method==='HEAD'?null:bytes,{headers:{
    'content-type':types[asset?.[2]??'html']+'; charset=utf-8',
    'cache-control':asset?'public, max-age=31536000, immutable':'no-cache',
    'content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; img-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'",
    'referrer-policy':'no-referrer','x-content-type-options':'nosniff',
  }});
}
