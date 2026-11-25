import http from 'node:http';
import {readFileSync,mkdirSync,openSync,writeFileSync,closeSync,unlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {build} from 'esbuild';
import {Store} from './store.mjs';
import {Engine} from './engine.mjs';
import {catalogue} from './catalogue.mjs';
import {createJobs,sourceIdentity} from './jobs.mjs';

const here=fileURLToPath(new URL('./',import.meta.url));
const security={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY',
  'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
export async function createRunner({store,engine,mode='mainnet',port=4195,jobs,identity}={}) {
  if(!store)throw Error('Explicit local store required');
  engine??=new Engine(store);jobs??=createJobs(store);identity??=sourceIdentity();
  const csrf=randomBytes(32).toString('hex');
  const bundle=await build({entryPoints:[join(here,'web/app.js')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
  const assets=new Map([['/',[readFileSync(join(here,'web/index.html')),'text/html']],['/app.js',[bundle.outputFiles[0].contents,'text/javascript']],['/style.css',[readFileSync(join(here,'web/style.css')),'text/css']]]);
  const server=http.createServer(async(req,res)=>{
    const send=(status,body,type='application/json')=>{res.writeHead(status,{...security,'content-type':type+'; charset=utf-8'});res.end(type==='application/json'?JSON.stringify(body):body);};
    try {
      const actualPort=server.address().port,hosts=['127.0.0.1:'+actualPort,'localhost:'+actualPort];
      if(!hosts.includes(req.headers.host)||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return send(403,{error:'Loopback only'});
      const origin='http://'+req.headers.host;
      if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'Origin rejected'});
      if(req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'Cross-site request rejected'});
      const url=new URL(req.url,origin),path=url.pathname;
      if(req.method==='GET') {
        if(assets.has(path)){const [body,type]=assets.get(path);return send(200,body,type);}
        if(path==='/api/state')return send(200,{mode,csrf,source:identity,catalogue:catalogue(),state:store.value});
        if(path==='/api/export') {res.setHeader('Content-Disposition','attachment; filename="poc-evidence.json"');return send(200,{exportedAt:new Date().toISOString(),mode,source:identity,catalogue:catalogue(),state:store.value});}
        if(/^\/metadata\/qa-[a-f0-9]{8}-nft\.json$/.test(path))return send(200,{name:path.split('/').at(-1).replace('.json',''),description:'Disposable technical test. No promised utility.',attributes:[{trait_type:'Purpose',value:'Disposable QA'}]});
        return send(404,{error:'Not found'});
      }
      if(req.method!=='POST')return send(405,{error:'Method not supported'});
      const supplied=Buffer.from(req.headers['x-poc-csrf']??'');
      if(req.headers.origin!==origin||supplied.length!==csrf.length||!timingSafeEqual(supplied,Buffer.from(csrf)))return send(403,{error:'Same-origin CSRF token required'});
      if(req.headers['content-type']!=='application/json')return send(415,{error:'JSON required'});
      let size=0;const parts=[];
      for await(const part of req){size+=part.length;if(size>12000)throw Error('Request exceeds 12 KB');parts.push(part);}
      const input=JSON.parse(Buffer.concat(parts).toString()||'{}');
      if(path==='/api/prepare')return send(200,await engine.prepare(input));
      if(path==='/api/observe')return send(200,await engine.observe());
      if(path==='/api/submit')return send(200,await engine.submit(input.id,input.signedTransaction));
      if(path==='/api/recover')return send(200,await engine.recover(input.id));
      if(path==='/api/checks')return send(202,jobs.start(input.poc));
      if(path==='/api/notes') {
        if(!catalogue().some(p=>p.id===input.poc)||typeof input.text!=='string'||!input.text.trim()||input.text.length>4000)throw Error('A POC and note of 1–4000 characters are required');
        store.value.notes.push({poc:input.poc,text:input.text.trim(),at:new Date().toISOString(),evidenceClass:'manual-unverified'});store.save();return send(200,{saved:true});
      }
      return send(404,{error:'Unknown operation'});
    } catch(error) {send(400,{error:error.message});}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
  server.on('close',()=>jobs.stop?.());
  return {server,origin:'http://127.0.0.1:'+server.address().port,csrf};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length>2)throw Error('No CLI overrides: runner always uses loopback port 4195 and mainnet');
  const base=process.env.LOCALAPPDATA;if(!base)throw Error('LOCALAPPDATA is required');
  const directory=join(base,'SolanaPocRunner');mkdirSync(directory,{recursive:true});
  const lock=join(directory,'runner.lock');let lockHandle;
  try {lockHandle=openSync(lock,'wx');}
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    const pid=Number(readFileSync(lock,'utf8'));
    if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid local runner lock; inspect '+lock);
    try {process.kill(pid,0);throw Error('Runner already active (PID '+pid+'). Open http://127.0.0.1:4195');}
    catch(check) {if(check.code!=='ESRCH')throw check;}
    unlinkSync(lock);lockHandle=openSync(lock,'wx');
  }
  writeFileSync(lockHandle,String(process.pid));
  process.once('exit',()=>{closeSync(lockHandle);unlinkSync(lock);});
  const store=new Store(join(directory,'evidence.sqlite'));
  const {origin,server}=await createRunner({store});
  console.log('Local POC runner: '+origin+' (mainnet, browser-wallet approvals only)');
  console.log('Evidence database: '+join(directory,'evidence.sqlite'));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{store.close();process.exit();}));
}
