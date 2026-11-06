import {nodeArtifactStore} from '../artifacts/node.mjs';
import {createOperatorUploadTransport} from './upload-transport.mjs';
import {randomBytes} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {openDatabase} from '../storage/database.mjs';
import {createLocalServer} from '../server/start.mjs';
import {json,failure} from '../server/api.mjs';
import {moderatorQueue,workloadMetrics} from '../earn/operations.mjs';
import {createOperatorSessionAuthority,OperatorSessionError} from './session.mjs';
import {createOperatorCommandTransport,readOperatorBody} from './command-transport.mjs';
import {EarnError} from '../earn/checks.mjs';
import {LOCAL_OPERATOR_COMMANDS} from '../application/operator-commands.mjs';
import {controlledScopes} from '../operations/portable-controls.mjs';
import {DAY_MS} from '../domain/earn/index.mjs';

const assets=new Map([['/',['index.html','text/html']],['/operator.js',['ui.mjs','text/javascript']],['/approval-packet.js',['approval-packet.mjs','text/javascript']],['/operator.css',['ui.css','text/css']]]);
const iso=n=>new Date(n).toISOString();
function parseDate(value){
 if(!/^\d{4}-\d\d-\d\d$/.test(value))throw new EarnError(400,'invalid_epoch','Select a valid UTC board date.');
 const ms=Date.parse(value+'T00:00:00Z');
 if(!Number.isSafeInteger(ms)||ms<0||iso(ms).slice(0,10)!==value)throw new EarnError(400,'invalid_epoch','Invalid UTC date.');
 return ms/DAY_MS;
}
export function createOperatorApp(db,{bootToken,clock=Date.now,operatorId='local-founder',allowedKinds=[],artifacts}){
 const sessions=createOperatorSessionAuthority({bootCode:bootToken,operatorId,allowedKinds,clock});
 const commands=createOperatorCommandTransport(db,{sessions,clock,artifacts}),uploads=createOperatorUploadTransport(db,{sessions,clock});
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
    const b=await readOperatorBody(request);
    if(Object.keys(b).length!==1||!Object.hasOwn(b,'code'))return failure(400,'invalid_body','Provide only the startup code.');
    const login=sessions.login(b.code);
    return json({sessionToken:login.sessionToken,expiresAt:iso(login.expiresAtMs)});
   }
   if(pathname.startsWith('/ops/commands/'))return commands(request);
   if(pathname.startsWith('/ops/uploads/'))return uploads(request);
   const raw=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
   const authorization=sessions.authenticate(raw);
   if(pathname==='/ops/logout'&&request.method==='POST'){sessions.revoke();return json({revoked:true});}
   if(pathname==='/ops/status'&&request.method==='GET')return json({mode:'local-fixture',expiresAt:iso(authorization.expiresAtMs),asOf:iso(now),
    principal:authorization.principal,allowedKinds:authorization.allowedKinds,financialExecution:false,
    expectedRevisions:Object.fromEntries(db.prepare('SELECT name,revision FROM app_revisions ORDER BY name').all().map(r=>[r.name,String(r.revision)]))});
   if(pathname==='/ops/config'&&request.method==='GET'){
    const latest=db.prepare('SELECT revision,paused FROM ops_scope_log WHERE scope=? ORDER BY at_ms DESC LIMIT 1');
    return json({nowMs:clock(),expectedRevisions:Object.fromEntries(db.prepare('SELECT name,revision FROM app_revisions ORDER BY name').all().map(r=>[r.name,String(r.revision)])),
     scopes:controlledScopes.map(scope=>{const row=latest.get(scope);return {scope,paused:!!row?.paused,revision:row?.revision??null};}),financialExecution:false});
   }
   if(pathname==='/ops/board'&&request.method==='GET'){
    const epoch=parseDate(searchParams.get('date')??iso(now).slice(0,10)),state=searchParams.get('state')??'pending';
    return json({metrics:workloadMetrics(db,{epoch,nowMs:now}),queue:moderatorQueue(db,{epoch,state,cursor:searchParams.get('cursor')})});
   }
   if(['/ops/capacity','/ops/reviews'].includes(pathname)&&request.method==='POST')
    return failure(503,'command_unavailable','This legacy write endpoint is unavailable. Use an authorized audited command preview.');
   return failure(404,'not_found','Unknown operator resource.');
  }catch(error){
   if(error instanceof EarnError||error instanceof OperatorSessionError)return failure(error.status,error.code,error.message,error.retryAfterSeconds?{'retry-after':String(error.retryAfterSeconds)}:{});
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
 const allowedKinds=(process.env.OPERATOR_COMMANDS??'').split(',').map(value=>value.trim()).filter(Boolean);
 if(allowedKinds.some(kind=>!LOCAL_OPERATOR_COMMANDS.includes(kind)))throw Error('Unknown local operator command in OPERATOR_COMMANDS.');
 const operatorId=process.env.OPERATOR_ID??'local-founder';
 const server=createLocalServer(createOperatorApp(db,{bootToken,operatorId,allowedKinds,artifacts:nodeArtifactStore(fileURLToPath(new URL('artifacts/',dir)))}));
 server.on('close',()=>db.close());
 server.listen(port,'127.0.0.1',()=>{
  console.log('Local 10X operator console: http://127.0.0.1:'+port+'/');
  console.log('One-time startup code (enter it in this local console only): '+bootToken);
 });
}
