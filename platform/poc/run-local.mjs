import {mkdirSync,existsSync,openSync,closeSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

if(process.argv.length!==3)throw Error('Supply one NEW local evidence directory.');
const output=resolve(process.argv[2]);
if(existsSync(output))throw Error('Refusing to overwrite an evidence directory.');
mkdirSync(output,{recursive:true});
const root=fileURLToPath(new URL('../../',import.meta.url));
const startedAt=new Date().toISOString();
const rev=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true});
if(rev.status!==0||!/^[a-f0-9]{40}\s*$/.test(rev.stdout))throw Error('Cannot determine exact source commit.');
const report={schemaVersion:1,evidenceClass:'local',startedAt,sourceCommit:rev.stdout.trim(),node:process.version,platform:process.platform,mainnetTransactions:0,spentUsd:0,checks:[]};
const tasks=[['reference',['platform/scripts/test-reference.mjs']],['contract-drift',['platform/contracts/generate.mjs','--check']]];
for(const [name,args] of tasks){
 const logfile=join(output,name+'.log'),fd=openSync(logfile,'wx');
 const start=Date.now();let result;
 try{result=spawnSync(process.execPath,args,{cwd:root,stdio:['ignore',fd,fd],windowsHide:true,timeout:45*60*1000});}
 finally{closeSync(fd);}
 const content=readFileSync(logfile);
 const text=content.toString('utf8');
 const totals={};
 for(const key of ['tests','pass','fail','cancelled','skipped','todo']){
  const matches=[...text.matchAll(new RegExp('^# '+key+' (\\d+)\\r?$','gm'))];
  if(matches.length)totals[key]=Number(matches.at(-1)[1]);
 }
 report.checks.push({name,args,exitCode:result.status,signal:result.signal,error:result.error?.code??null,durationMs:Date.now()-start,totals,log:name+'.log',sha256:createHash('sha256').update(content).digest('hex'),passed:result.status===0&&!result.error});
 writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report.checks.at(-1)));
}
report.finishedAt=new Date().toISOString();
report.passed=report.checks.every(c=>c.passed);
writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:join(output,'report.json'),passed:report.passed,mainnetTransactions:0}));
process.exitCode=report.passed?0:1;
