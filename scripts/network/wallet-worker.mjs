import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const root=resolve(import.meta.dirname,'../..');
const log=(value)=>console.log(JSON.stringify({at:new Date().toISOString(),...value}));
let wake;
const sleep=(ms)=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);wake=()=>{clearTimeout(timer);resolve();};});
let child,stopping=false;
process.on('SIGTERM',()=>{stopping=true;child?.kill();wake?.();});
process.on('SIGINT',()=>{stopping=true;child?.kill();wake?.();});
await writeFile(resolve(root,'.tmp/network-wallet-worker.pid'),String(process.pid));
while(!stopping){
 let lastStatus='',failure='';
 log({event:'batch_started',wallets:1000,provider:'alchemy',concurrency:4,maxRequestsPerSecond:10});
 const code=await new Promise((resolveExit,reject)=>{
  child=spawn(process.execPath,[resolve(root,'node_modules/tsx/dist/cli.mjs'),resolve(root,'scripts/network/local.ts'),'--wallet-values','--alchemy','--steps=1000'],{cwd:root,env:{...process.env,WRANGLER_SEND_METRICS:'false'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='';
  child.stdout.on('data',chunk=>{const text=chunk.toString();process.stdout.write(text);stdout+=text;const lines=stdout.split(/\r?\n/);stdout=lines.pop()??'';for(const line of lines){try{const item=JSON.parse(line);if(item.status)lastStatus=item.status;}catch{}}});
  child.stderr.on('data',chunk=>{const text=chunk.toString();process.stderr.write(text);failure=(failure+text).slice(-12000);});
  child.once('error',reject);child.once('exit',resolveExit);
 });
 child=undefined;
 if(stopping)break;
 let delay=5000;
 if(/budget exhausted/.test(failure)){
  const now=new Date();delay=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)-Date.now()+60_000;
  log({event:'daily_budget_pause',resumeAt:new Date(Date.now()+delay).toISOString()});
 }else if(/Alchemy HTTP (429|402|403)|Alchemy RPC request rejected/.test(failure)||['cooldown','waiting'].includes(lastStatus)){
  delay=3_600_000;log({event:'source_pause',minutes:60});
 }else if(code!==0){delay=900_000;log({event:'import_retry_pause',minutes:15,reason:'Importer failed; previous values retained; inspect the local error log'});}
 else if(lastStatus==='complete'){delay=86_400_000;log({event:'caught_up',nextCheckHours:24});}
 else if(lastStatus==='busy'){delay=60_000;log({event:'lease_pause',minutes:1});}
 await sleep(delay);
}
