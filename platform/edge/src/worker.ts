import { Hono } from 'hono';
import { z } from 'zod';
import { policy } from '../../contracts/policy.mjs';
import { launchFeeBps } from '../../domain/economics/launch.mjs';
import { represent } from '../../contracts/transport.mjs';
import baseContract from '../../contracts/openapi.json';
import { edgeAuth } from './wallet';

const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();
const supportedPaths = new Set(['/health','/policy','/collections','/launch/fee-schedule','/markets','/markets/{id}',
  '/me','/me/wallets','/auth/challenges','/auth/verify','/auth/logout']);
const allRoutes = baseContract.paths as Record<string, object>;
const paths = {...Object.fromEntries(Object.entries(allRoutes).filter(([path])=>supportedPaths.has(path))),
  '/manifests/{digest}':{parameters:[{in:'path',name:'digest',required:true,schema:{type:'string',pattern:'^[0-9a-f]{64}$'}}],
  get:{operationId:'getVerifiedManifest',responses:{200:{description:'Exact public bytes verified against the published digest'},503:{description:'Referenced evidence missing or corrupt'}}}}};
const base = '/api/v1';
const digest = async (bytes: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))]
  .map(b=>b.toString(16).padStart(2,'0')).join('');
const query = z.object({limit:z.coerce.number().int().min(1).max(100).default(25),
  cursor:z.string().regex(/^[A-Za-z0-9_-]{1,160}$/).optional()}).strict();

app.use('*', async (c,next)=>{
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('x-request-id',requestId);
  c.header('x-content-type-options','nosniff');
  c.header('cache-control','no-store');
  const {hostname} = new URL(c.req.url);
  if (!['localhost','127.0.0.1'].includes(hostname)) return c.json({error:{code:'local_only',message:'Local validation runtime only.',retryable:false,requestId}},403);
  await next();
  if(!new URL(c.req.url).pathname.startsWith('/api/v1/manifests/'))c.res=await represent(c.req.raw,c.res,Date.now());
});
app.onError((_error,c)=>c.json({error:{code:'internal_error',message:'Request could not be completed.',retryable:false,requestId:c.get('requestId')}},500));
app.notFound(c=>c.json({error:{code:'not_found',message:'Unknown local Worker route.',retryable:false,requestId:c.get('requestId')}},404));
app.get(base+'/openapi.json',c=>c.json({...baseContract,info:{...baseContract.info,title:'10X.MEME local Worker API'},paths}));
app.get(base+'/health',c=>c.json({status:'ok',policyVersion:policy.version,mode:policy.mode,runtime:'workerd-local'}));
app.get(base+'/policy',c=>c.json(policy));
app.get(base+'/collections',c=>c.json({items:[{id:'genesis',status:'planned',...policy.genesis},{id:'seasons',status:'planned',...policy.season}],nextCursor:null,snapshotId:policy.version}));
app.get(base+'/launch/fee-schedule',c=>c.json({unit:'basis-points',clock:'actual-activation',points:Array.from({length:91},(_,i)=>({
  elapsedSeconds:i,feeBps:Number(launchFeeBps({activatedAt:0n,at:BigInt(i)}))}))}));

function marketView(body:string,now:number) {
  const m=JSON.parse(body);
  const elapsed=Math.floor((now-Date.parse(m.activatedAt))/1000);
  return {...m,chain:'solana',status:elapsed<0?'scheduled':elapsed<864000?'active':'campaign-ended',
    feeBps:elapsed<0?null:Number(launchFeeBps({activatedAt:0n,at:BigInt(elapsed)})),executable:false};
}
app.get(base+'/markets',async c=>{
  const url=new URL(c.req.url);
  const parsed=query.safeParse(Object.fromEntries(url.searchParams));
  if(!parsed.success||[...url.searchParams.keys()].some(k=>url.searchParams.getAll(k).length!==1))
    return c.json({error:{code:'invalid_query',message:'Invalid catalog query.'}},400);
  const high=(await c.env.DB.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM market_fixtures').first<number>('n'))??0;
  let watermark=high,at=Date.now(),before=high+1;
  if(parsed.data.cursor){
    try {
      const decoded=JSON.parse(atob(parsed.data.cursor.replace(/-/g,'+').replace(/_/g,'/')));
      if(!Array.isArray(decoded)||decoded.length!==3||!decoded.every(n=>Number.isSafeInteger(n)&&n>=0))throw Error();
      [watermark,at,before]=decoded;
      if(watermark>high||at>Date.now()||before>watermark||before<1)throw Error();
    }catch{return c.json({error:{code:'invalid_cursor',message:'Invalid catalog cursor.'}},400);}
  }
  const limit=parsed.data.limit;
  const {results}=await c.env.DB.prepare('SELECT seq,body FROM market_fixtures WHERE seq<=? AND seq<? ORDER BY seq DESC LIMIT ?')
    .bind(watermark,before,limit+1).all<{seq:number;body:string}>();
  const page=results.slice(0,limit);
  const next=results.length>limit?btoa(JSON.stringify([watermark,at,page.at(-1)!.seq])).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'):null;
  return c.json({items:page.map(r=>marketView(r.body,at)),nextCursor:next,snapshotId:'fixture-'+watermark+'-'+at,asOf:new Date(at).toISOString()});
});
app.get(base+'/markets/:id',async c=>{
 const record=await c.env.DB.prepare('SELECT body FROM market_fixtures WHERE id=?').bind(c.req.param('id')).first<string>('body');
 return record?c.json(marketView(record,Date.now())):c.json({error:{code:'market_not_found',message:'Unknown market.'}},404);
});
app.get(base+'/manifests/:digest',async c=>{
 const key=c.req.param('digest')??'';
 if(!/^[0-9a-f]{64}$/.test(key))return c.json({error:{code:'invalid_digest',message:'Invalid content digest.'}},400);
 const row=await c.env.DB.prepare('SELECT object_key,size_bytes FROM manifest_catalog WHERE byte_digest=?').bind(key).first<{object_key:string;size_bytes:number}>();
 if(!row)return c.json({error:{code:'not_found',message:'Unknown public manifest.'}},404);
 if(row.size_bytes>2*1024*1024||row.size_bytes<1||row.object_key!=='public/'+key+'.json')return c.json({error:{code:'invalid_manifest',message:'Manifest metadata mismatch.'}},503);
 const object=await c.env.MANIFESTS.get(row.object_key);
 if(!object||object.size!==row.size_bytes)return c.json({error:{code:'missing_manifest',message:'Manifest unavailable.'}},503);
 const bytes=await object.arrayBuffer();
 if(await digest(bytes)!==key)return c.json({error:{code:'invalid_manifest',message:'Manifest integrity check failed.'}},503);
 return new Response(bytes,{headers:{'content-type':'application/json','etag':'"'+key+'"','cache-control':'public,max-age=86400,immutable','x-content-type-options':'nosniff'}});
});
app.route(base,edgeAuth);
export default app;
