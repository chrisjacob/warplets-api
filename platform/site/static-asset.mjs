import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {brotliCompress,gzip,constants} from 'node:zlib';
import {promisify} from 'node:util';
const brotli=promisify(brotliCompress),zip=promisify(gzip);
const cache=new Map(),pending=new Map(),maxBytes=8*1024*1024,maxEntries=64;let cachedBytes=0;
// Only public, versioned build assets enter this cache. HTML and API bodies do not.
// These bounds apply to retained representations, not all transient request memory.
async function load(url){
 const key=url.href,info=await stat(url),version=info.size+':'+info.mtimeMs+':'+info.ctimeMs;
 const previous=cache.get(key);
 if(previous?.version===version){cache.delete(key);cache.set(key,previous);return previous;}
 if(previous){cache.delete(key);cachedBytes-=previous.size;}
 const pendingKey=key+'\0'+version;
 if(pending.has(pendingKey))return pending.get(pendingKey);
 const loading=buildEntry(url,key,version);pending.set(pendingKey,loading);
 try{return await loading;}finally{if(pending.get(pendingKey)===loading)pending.delete(pendingKey);}
}
async function buildEntry(url,key,version){
 const identity=await readFile(url),bodies={identity};
 if(identity.length>=1024){
  const [br,gz]=await Promise.all([brotli(identity,{params:{[constants.BROTLI_PARAM_QUALITY]:4}}),zip(identity)]);
  if(br.length<identity.length)bodies.br=br;if(gz.length<identity.length)bodies.gzip=gz;
 }
 const entry={version,bodies,tag:'W/"'+createHash('sha256').update(identity).digest('hex')+'"',size:Object.values(bodies).reduce((n,b)=>n+b.length,0)};
 // Concurrent readers may have filled the same key while compression was running.
 if(cache.has(key)){cachedBytes-=cache.get(key).size;cache.delete(key);}
 if(entry.size<=maxBytes){
  while(cache.size>=maxEntries||cachedBytes+entry.size>maxBytes){const oldest=cache.keys().next().value;cachedBytes-=cache.get(oldest).size;cache.delete(oldest);}
  cache.set(key,entry);cachedBytes+=entry.size;
 }
 return entry;
}
function encoding(header,bodies){
 if(!header)return 'identity';
 const weights=new Map();
 for(const item of header.toLowerCase().split(',')){
  const [name,...parameters]=item.trim().split(';');let weight=1;
  for(const p of parameters){const match=/^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/.exec(p);weight=match?Number(match[1]):0;}
  weights.set(name,weight);
 }
 const quality=name=>weights.get(name)??(name==='identity'?(weights.get('*')===0?0:1):weights.get('*')??0);
 return ['br','gzip','identity'].filter(name=>bodies[name]&&quality(name)>0).sort((a,b)=>quality(b)-quality(a))[0]??null;
}
export async function staticAsset(request,url,headers){
 const entry=await load(url),selected=encoding(request.headers.get('accept-encoding'),entry.bodies);
 headers=new Headers(headers);headers.set('vary','Accept-Encoding');headers.set('etag',entry.tag);
 if(!selected){headers.set('cache-control','no-store');return new Response(null,{status:406,headers});}
 if(selected!=='identity')headers.set('content-encoding',selected);
 const validators=request.headers.get('if-none-match')?.split(',').map(s=>s.trim().replace(/^W\//,''))??[];
 if(validators.includes('*')||validators.includes(entry.tag.slice(2)))return new Response(null,{status:304,headers});
 const body=entry.bodies[selected];headers.set('content-length',String(body.length));
 return new Response(request.method==='HEAD'?null:body,{headers});
}
