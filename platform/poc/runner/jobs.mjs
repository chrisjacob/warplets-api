import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {checks} from './catalogue.mjs';

export const root=fileURLToPath(new URL('../../../',import.meta.url));
export const platform=fileURLToPath(new URL('../../',import.meta.url));
export function sourceIdentity() {
  const git=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true});
  const hash=createHash('sha256');
  const scan=directory=>{for(const e of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    if(e.name.startsWith('.')||['node_modules','runs','dist'].includes(e.name))continue;
    const path=join(directory,e.name);
    if(e.isDirectory())scan(path);else if(/\.(mjs|js|cjs|ts|json|html|css|yaml|sql|gz)$/.test(e.name)){const bytes=readFileSync(path);hash.update(relative(platform,path).replaceAll('\\','/')+'\0'+bytes.length+'\0');hash.update(bytes);}
  }};
  // Include imported platform modules, schemas and captured program fixtures;
  // git commit alone cannot identify uncommitted source changes.
  scan(platform);
  return {commit:git.status===0?git.stdout.trim():null,platformSourceSha256:hash.digest('hex'),node:process.version};
}

export function createJobs(store) {
  let child=null;
  return {
    start(poc) {
      if(child)throw Error('A local check is already running');
      const files=poc==='ALL'?[...new Set(Object.values(checks).flat())]:checks[poc];
      if(!files)throw Error('Unknown POC');
      const job={id:randomUUID(),poc,evidenceClass:'local',status:'running',startedAt:new Date().toISOString(),source:sourceIdentity(),files,log:'',mainnetTransactions:0};
      store.value.checks.push(job);store.save();
      child=spawn(process.execPath,['--test',...files],{cwd:platform,windowsHide:true,stdio:['ignore','pipe','pipe']});
      const running=child;
      const append=data=>{const next=job.log+data.toString();if(next.length>300000)job.logTruncated=true;job.log=next.slice(-300000);store.save();};
      running.stdout.on('data',append);running.stderr.on('data',append);
      const timer=setTimeout(()=>{job.error='Local check exceeded 15 minutes';running.kill();},15*60*1000);
      let done=false;
      const finish=(code,error)=>{if(done)return;done=true;clearTimeout(timer);child=null;job.exitCode=code;job.status=code===0&&!error?'passed':'failed';job.finishedAt=new Date().toISOString();if(error)job.error=error;job.logSha256=createHash('sha256').update(job.log).digest('hex');store.save();};
      running.on('error',error=>finish(null,error.message));running.on('close',code=>finish(code));
      return job;
    },
    stop(){child?.kill();},
  };
}
