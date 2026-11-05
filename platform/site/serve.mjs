import { readFile } from 'node:fs/promises';
import { initialPage, renderInitialPage, routeFor } from './public-pages.mjs';

const assetPattern=/^\/site-assets\/([A-Za-z0-9_-]+\.(js|css))$/;
const types={html:'text/html',css:'text/css',js:'text/javascript'};

/** Serve the explicitly built local frontend. An absent build returns null so a
 * host can use the reference viewer while installing offline dependencies. No
 * deployment hook, web tunnel or external asset serving is configured here.
 */
export async function serveSite(request, dist=new URL('./dist/',import.meta.url),readPublic){
  const requestUrl=new URL(request.url),path=requestUrl.pathname,asset=assetPattern.exec(path),route=routeFor(requestUrl);
  const image=path==='/social-card.png';
  if(!route&&!asset&&!image)return null;
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',
    {status:405,headers:{Allow:'GET, HEAD'}});
  const url=image?new URL('social-card.png',dist):asset?new URL('site-assets/'+asset[1],dist):new URL('index.html',dist);
  let bytes;
  try {bytes=await readFile(url);}
  catch(error){
    if(error.code!=='ENOENT')throw error;
    if(!asset&&!image)return null;
    return new Response('Asset not found',{status:404,headers:{'cache-control':'no-store'}});
  }
  let status=200;
  if(route){
    const page=await initialPage(route,requestUrl,readPublic);
    bytes=renderInitialPage(bytes.toString('utf8'),page);
    status=page.status;
  }
  return new Response(request.method==='HEAD'?null:bytes,{status,headers:{
    'content-type':image?'image/png':types[asset?.[2]??'html']+'; charset=utf-8',
    'cache-control':asset?'public, max-age=31536000, immutable':'no-cache',
    'content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; img-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'",
    'referrer-policy':'no-referrer','x-content-type-options':'nosniff',
    'x-robots-tag':route?.private||status!==200?'noindex, nofollow':'noindex, follow',
  }});
}
