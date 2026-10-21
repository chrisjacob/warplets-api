import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const root=resolve(import.meta.dirname,'../..');
const log=value=>console.log(JSON.stringify({at:new Date().toISOString(),...value}));
let child,stopping=false,wake;
const sleep=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);wake=()=>{clearTimeout(timer);resolve();};});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;child?.kill();wake?.();});
await writeFile(resolve(root,'.tmp/network-location-worker.pid'),String(process.pid));
while(!stopping){
 let remaining=null,failure='',saved=0,lastStatus='';
 log({event:'location_backfill_started'});
 const code=await new Promise((resolveExit,reject)=>{
  child=spawn(process.execPath,[resolve(root,'node_modules/tsx/dist/cli.mjs'),resolve(root,'scripts/network/local.ts'),'--location-backfill','--steps=1000'],{cwd:root,env:{...process.env,WRANGLER_SEND_METRICS:'false'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='';
  child.stdout.on('data',chunk=>{process.stdout.write(chunk);stdout+=chunk.toString();const lines=stdout.split(/\r?\n/);stdout=lines.pop()??'';for(const line of lines){try{const item=JSON.parse(line);if(item.locationBackfill)remaining=item.locationBackfill.remaining;if(item.profilesSaved)saved+=item.profilesSaved;if(item.status)lastStatus=item.status;}catch{}}});
  child.stderr.on('data',chunk=>{process.stderr.write(chunk);failure=(failure+chunk.toString()).slice(-12000);});
  child.once('error',reject);child.once('exit',resolveExit);
 });
 child=undefined;
 if(stopping)break;
 if(code===0&&remaining===0){log({event:'location_backfill_complete'});break;}
 let delay=60_000;
 if(/budget exhausted/.test(failure)){
  const now=new Date();delay=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)-Date.now()+60_000;
  log({event:'daily_budget_pause',resumeAt:new Date(Date.now()+delay).toISOString()});
 }else if(code!==0){delay=900_000;log({event:'source_pause',minutes:15});}
 else if(saved===0&&lastStatus!=='busy'){delay=900_000;log({event:'retry_wait',minutes:15,remaining});}
 await sleep(delay);
}
