import {readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {createApp} from '../server/application.mjs';
import {createLocalServer} from '../server/start.mjs';
import {createPerformanceService} from '../performance/leaderboards.mjs';
import {parseArgs} from './populate.mjs';
import {createSyntheticReviewPreview} from '../ai-review/fixture.mjs';
import {loadPublicIdentities,publicIdentityResponse} from './public-identities.mjs';
const args=process.argv.slice(2),overlayIndex=args.indexOf('--identity-overlay');let overlayPath=null;
if(overlayIndex!==-1){if(!args[overlayIndex+1]||args[overlayIndex+1].startsWith('--')||args.lastIndexOf('--identity-overlay')!==overlayIndex)throw Error('Supply one --identity-overlay manifest path.');overlayPath=args[overlayIndex+1];args.splice(overlayIndex,2);}
const a=parseArgs(args),port=Number(a.port??4181);
if(!a.directory||!Number.isInteger(port)||port<1024||port>65535)throw Error('Supply --directory and a local port from 1024 to 65535.');
const origin=a.origin??'http://127.0.0.1:'+port,parsed=new URL(origin);
if(parsed.origin!==origin||(!['https:','http:'].includes(parsed.protocol))||(parsed.protocol==='http:'&&!['127.0.0.1','localhost'].includes(parsed.hostname)))throw Error('Use an exact HTTPS origin or loopback HTTP origin.');
const reviewPreview=await createSyntheticReviewPreview();
function loadScenario(path,overlay=null){
 const directory=resolve(path);
 if(existsSync(join(directory,'FAILED.txt')))throw Error('Refusing to serve an incomplete scenario.');
 const report=JSON.parse(readFileSync(join(directory,'scenario.json'),'utf8'));
 if(report.scope!=='synthetic-local-only'||report.status!=='complete')throw Error('Not a complete local QA scenario.');
 const bytes=readFileSync(join(directory,'performance.json'));
 if(createHash('sha256').update(bytes).digest('hex')!==report.performance.sha256)throw Error('QA snapshot digest differs from its generation report.');
 if(!existsSync(join(directory,'core.sqlite')))throw Error('Missing QA core database; refusing to create an empty one.');
 const snapshot=JSON.parse(bytes),db=openDatabase(join(directory,'core.sqlite'));
 const timeline=existsSync(join(directory,'timeline.json'))?JSON.parse(readFileSync(join(directory,'timeline.json'),'utf8')):null;
 return {directory,report,db,timeline,identityOverlay:overlay?loadPublicIdentities(overlay,{snapshot,report}):null,
  app:createApp(db,{performanceService:createPerformanceService(snapshot),qaReviewPreview:reviewPreview})};
}
const launch=loadScenario(a.directory,overlayPath),future=a['future-directory']?loadScenario(a['future-directory']):null;
if(future&&(launch.timeline?.mode!=='season-0'||future.timeline?.mode!=='six-months'))throw Error('Timeline switching requires launch and six-month scenario manifests.');
const server=createLocalServer(async(request,peer)=>{
 if(!['GET','HEAD'].includes(request.method)&&request.headers.get('origin')!==origin)return new Response('Origin rejected',{status:403});
 const url=new URL(request.url),headers=new Headers(request.headers);
 if(future&&url.pathname.startsWith('/__timeline/')){
  const mode=url.pathname.slice('/__timeline/'.length);
  if(!['season-0','six-months'].includes(mode))return new Response('Unknown timeline',{status:404});
  if(!['GET','HEAD'].includes(request.method))return new Response('Use GET',{status:405,headers:{allow:'GET, HEAD'}});
  const secure=parsed.protocol==='https:'?'; Secure':'';
  const out=new Headers({location:'/', 'cache-control':'no-store'});
  out.append('set-cookie','tenx_preview_timeline='+mode+'; Path=/; HttpOnly; SameSite=Lax'+secure);
  // A timeline change is a full navigation into an independent database/session namespace.
  out.append('set-cookie','tenx_local_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'+secure);
  return new Response(null,{status:303,headers:out});
 }
 const selected=/(?:^|;\s*)tenx_preview_timeline=season-0(?:;|$)/.test(headers.get('cookie')??'')?launch:future??launch;
 for(const key of [...headers.keys()])if(key==='forwarded'||key.startsWith('x-forwarded-')||key.startsWith('cf-'))headers.delete(key);
 const translated=new Request(origin+url.pathname+url.search,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer()});
 const response=publicIdentityResponse(translated,selected.identityOverlay)??await selected.app(translated,peer),out=new Headers(response.headers);
 if(!/^(?:\/site-assets\/[A-Za-z0-9_-]+\.(js|css|webp|png|ttf)|\/qa-media\/[a-f0-9]{64}\.(png|jpg|webp|gif))$/.test(url.pathname)||!out.get('cache-control')?.includes('immutable'))out.set('cache-control','no-store');
 out.set('x-tenx-preview',selected.timeline?.mode??'synthetic-'+(selected.report.historyDays??90)+'-day-qa');
 const cookie=out.get('set-cookie');if(cookie&&parsed.protocol==='https:'&&!/;\s*Secure(?:;|$)/i.test(cookie))out.set('set-cookie',cookie+'; Secure');
 let body=response.body;
 if(request.method==='GET'&&out.get('content-type')?.includes('text/html')){
  body=await response.text();
  if(selected.identityOverlay)body=body.replace('</head>','<meta name="tenx-qa-public-identities" content="enabled"></head>');
  if(future){
   const data=JSON.stringify(selected.timeline).replaceAll('<','\\u003c');
   body=body.replace('</head>','<script id="tenx-timeline" type="application/json">'+data+'</script></head>');
  }
  out.delete('content-length');
 }
 return new Response(body,{status:response.status,headers:out});
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({scope:'synthetic-local-only',origin,port,directory:launch.directory,futureDirectory:future?.directory,wallet:launch.report.wallet,asOf:launch.report.asOf,financialExecution:false})));
const stop=()=>{server.closeAllConnections();server.close(()=>{launch.db.close();future?.db.close();process.exit(0);});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
