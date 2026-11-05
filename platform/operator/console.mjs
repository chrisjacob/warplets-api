import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openDatabase} from '../storage/database.mjs';
import {createLocalServer} from '../server/start.mjs';
import {json,failure} from '../server/api.mjs';
import {moderatorQueue,workloadMetrics,configureWorkload} from '../earn/operations.mjs';
import {createNodeEarnService} from '../application/node-context.mjs';
import {EarnError} from '../earn/checks.mjs';
import {DAY_MS} from '../domain/earn/index.mjs';

const hash=s=>createHash('sha256').update(s).digest();
const ttl=2*3600000;
const assets=new Map([['/',['index.html','text/html']],['/operator.js',['ui.mjs','text/javascript']],['/operator.css',['ui.css','text/css']]]);
const iso=n=>new Date(n).toISOString();
function parseDate(value){
 if(!/^\d{4}-\d\d-\d\d$/.test(value))throw new EarnError(400,'invalid_epoch','Select a valid UTC board date.');
 const ms=Date.parse(value+'T00:00:00Z');
 if(!Number.isSafeInteger(ms)||ms<0||iso(ms).slice(0,10)!==value)throw new EarnError(400,'invalid_epoch','Invalid UTC date.');
 return ms/DAY_MS;
}
async function body(request){
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new EarnError(415,'media_type','Use application/json.');
 try{
  const text=await request.text();if(text.length>4096)throw Error();
  const value=JSON.parse(text);if(!value||Array.isArray(value)||typeof value!=='object')throw Error();return value;
 }catch{throw new EarnError(400,'invalid_body','Expected a bounded JSON object.');}
}
export function createOperatorApp(db,{bootToken,clock=Date.now}){
 if(typeof bootToken!=='string'||bootToken.length<32)throw Error('Generate a strong operator bootstrap token.');
 const bootDigest=hash(bootToken);let used=false,session=null,activeUntil=0,failures=0,attemptWindow=0;
 return async request=>{
  const {origin,hostname,pathname,searchParams}=new URL(request.url),now=clock();
  if(!['localhost','127.0.0.1'].includes(hostname))return failure(403,'local_only','Use the local operator origin.');
  if(assets.has(pathname)&&request.method==='GET'){
   const [file,type]=assets.get(pathname);
   return new Response(await readFile(new URL(file,import.meta.url)),{headers:{'content-type':type+'; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
  }
  if(!pathname.startsWith('/ops/'))return failure(404,'not_found','Unknown operator resource.');
  try{
   if(request.method==='POST'&&request.headers.get('origin')!==origin)return failure(403,'invalid_origin','Use the operator origin.');
   if(pathname==='/ops/login'&&request.method==='POST'){
    if(now>=attemptWindow){attemptWindow=now+60000;failures=0;}
    if(failures>=5)return failure(429,'rate_limited','Try again later.',{'retry-after':String(Math.ceil((attemptWindow-now)/1000))});
    const {code}=await body(request);
    if(used||typeof code!=='string'||!timingSafeEqual(hash(code),bootDigest)){failures++;return failure(401,'invalid_code','Operator code unavailable.');}
    used=true;const raw=randomBytes(32).toString('base64url');session=hash(raw);activeUntil=now+ttl;
    return json({sessionToken:raw,expiresAt:iso(activeUntil)});
   }
   const raw=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
   if(!raw||!session||activeUntil<=now||!timingSafeEqual(hash(raw),session))return failure(401,'operator_required','Enter the local startup code.');
   if(pathname==='/ops/logout'&&request.method==='POST'){session=null;return json({revoked:true});}
   if(pathname==='/ops/status'&&request.method==='GET')return json({mode:'local-fixture',expiresAt:iso(activeUntil),asOf:iso(now)});
   if(pathname==='/ops/board'&&request.method==='GET'){
    const epoch=parseDate(searchParams.get('date')??iso(now).slice(0,10)),state=searchParams.get('state')??'pending';
    return json({metrics:workloadMetrics(db,{epoch,nowMs:now}),queue:moderatorQueue(db,{epoch,state,cursor:searchParams.get('cursor')})});
   }
   if(pathname==='/ops/capacity'&&request.method==='POST'){
    const b=await body(request),effectiveEpoch=parseDate(b.date);
    return json(configureWorkload(db,{effectiveEpoch,atMs:now,staffedMinutes:b.staffedMinutes,secondsPerReview:b.secondsPerReview,
      admissionLimit:b.admissionLimit,operator:'local-founder',reason:b.reason}));
   }
   if(pathname==='/ops/reviews'&&request.method==='POST'){
    const b=await body(request);
    if(b.final!==true)return failure(422,'final_required','A published review is final.');
    const result=await createNodeEarnService(db,{nowMs:now}).recordFinalReview({kind:'operator',id:'local-founder'},
      {submissionId:b.submissionId,score:b.score,reason:b.reason,sourceRef:'operator/review/'+b.submissionId});
    return json(result);
   }
   return failure(404,'not_found','Unknown operator resource.');
  }catch(error){
   if(error instanceof EarnError)return failure(error.status,error.code,error.message);
   return failure(500,'internal_error','Operator request failed.');
  }
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const dir=new URL('../.local/',import.meta.url);
 await mkdir(dir,{recursive:true});
 const db=openDatabase(fileURLToPath(new URL('preview.sqlite',dir)));
 const bootToken=randomBytes(32).toString('base64url'),port=Number(process.env.OPERATOR_PORT??4174);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid operator port.');
 const server=createLocalServer(createOperatorApp(db,{bootToken}));
 server.on('close',()=>db.close());
 server.listen(port,'127.0.0.1',()=>{
  console.log('Local 10X operator console: http://127.0.0.1:'+port+'/');
  console.log('One-time startup code (enter it in this local console only): '+bootToken);
 });
}
