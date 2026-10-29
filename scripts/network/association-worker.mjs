import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const root=resolve(import.meta.dirname,'../..');
const log=value=>console.log(JSON.stringify({at:new Date().toISOString(),...value}));
let child,stopping=false,wake;
const sleep=ms=>new Promise(resolve=>{const timer=setTimeout(resolve,ms);wake=()=>{clearTimeout(timer);resolve();};});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;child?.kill();wake?.();});
await writeFile(resolve(root,'.tmp/network-association-worker.pid'),String(process.pid));
while(!stopping){
  let failure='',complete=false,pending='';
  log({event:'wallet_links_started',monthlyCreditCap:250000});
  const code=await new Promise((resolveExit,reject)=>{
    child=spawn(process.execPath,[resolve(root,'node_modules/tsx/dist/cli.mjs'),resolve(root,'scripts/network/local.ts'),'--wallet-addresses','--steps=1000'],{cwd:root,env:{...process.env,NETWORK_WALLET_CREDITS:'250000',WRANGLER_SEND_METRICS:'false'},windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',chunk=>{process.stdout.write(chunk);pending+=chunk.toString();const lines=pending.split(/\r?\n/);pending=lines.pop()??'';for(const line of lines){try{if(JSON.parse(line).associationFids===0)complete=true;}catch{}}});
    child.stderr.on('data',chunk=>{process.stderr.write(chunk);failure=(failure+chunk.toString()).slice(-12000);});
    child.once('error',reject);child.once('exit',resolveExit);
  });
  child=undefined;if(stopping)break;
  let delay=15000;
  if(/credit cap/.test(failure)){
    const now=new Date();delay=Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)-Date.now()+60000;
    log({event:'monthly_credit_pause',resumeAt:new Date(Date.now()+delay).toISOString()});
  }else if(/budget exhausted/.test(failure)){
    const now=new Date();delay=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)-Date.now()+60000;
    log({event:'daily_request_pause',resumeAt:new Date(Date.now()+delay).toISOString()});
  }else if(code!==0){delay=3600000;log({event:'source_pause',minutes:60});}
  else if(complete){delay=86400000;log({event:'wallet_links_caught_up',nextCheckHours:24});}
  await sleep(delay);
}
