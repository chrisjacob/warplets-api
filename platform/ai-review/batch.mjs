import {closeSync,existsSync,fstatSync,mkdirSync,openSync,readSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonicalJson} from '../security/canonical.mjs';
import {evaluateSubmission,normalizeJob} from './review.mjs';
import {syntheticProvider} from './fixture.mjs';
import {createOpenAIProvider} from './openai-provider.mjs';

export const MAX_BATCH_JOBS=25;
export const MAX_MANIFEST_BYTES=1048576;
const hash=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const require=(condition,message)=>{if(!condition)throw new TypeError(message);};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const write=(file,value)=>writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',encoding:'utf8',mode:0o600});

/** Bounded read even if a local input file changes between stat and read. */
export function readBatchManifest(file){
 require(typeof file==='string'&&file.trim().length>0,'Specify --input.');
 const descriptor=openSync(file,'r');
 try{
  const stat=fstatSync(descriptor);
  require(stat.isFile()&&stat.size<=MAX_MANIFEST_BYTES,'Manifest must be a regular file no larger than 1 MiB.');
  const buffer=Buffer.alloc(MAX_MANIFEST_BYTES+1);let length=0;
  while(length<buffer.length){const count=readSync(descriptor,buffer,length,buffer.length-length,null);if(count===0)break;length+=count;}
  require(length<=MAX_MANIFEST_BYTES,'Manifest exceeds 1 MiB.');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,length)).replace(/^\uFEFF/,''));
 }finally{closeSync(descriptor);}
}

export function normalizeManifest(manifest,maxJobs){
 require(Number.isInteger(maxJobs)&&maxJobs>=1&&maxJobs<=MAX_BATCH_JOBS,'Explicit maxJobs must be an integer from 1 to 25.');
 require(exact(manifest,['kind','jobs'])&&manifest.kind==='10x.ai-review-batch.v1','Supply the exact captured-job batch manifest fields.');
 require(Buffer.byteLength(JSON.stringify(manifest),'utf8')<=MAX_MANIFEST_BYTES,'Manifest exceeds 1 MiB.');
 require(Array.isArray(manifest.jobs)&&manifest.jobs.length>=1&&manifest.jobs.length<=maxJobs,'Manifest job count must be 1 through maxJobs.');
 const jobs=manifest.jobs.map(normalizeJob),ids=new Set();
 for(const job of jobs){require(!ids.has(job.submissionId),'Repeated submission IDs are forbidden, including changed captures.');ids.add(job.submissionId);}
 return Object.freeze({kind:manifest.kind,jobs:Object.freeze(jobs)});
}

function metadataFor(provider){
 require(provider&&typeof provider.evaluate==='function'&&[provider.id,provider.model,provider.version].every(validId),'Supply a named and versioned provider.');
 require(['synthetic','model'].includes(provider.kind)&&['local-fixture','declared-local-adapter','operator-import'].includes(provider.provenance),'Invalid provider kind or provenance.');
 require((provider.kind==='synthetic')===(provider.provenance==='local-fixture'),'Synthetic results must identify fixture provenance.');
 require(provider.responseFormat===undefined||provider.responseFormat==='evaluation-with-evidence-v1','Unsupported provider response format.');
 return Object.freeze({id:provider.id,model:provider.model,version:provider.version,kind:provider.kind,provenance:provider.provenance});
}
function timestamp(clock){const value=clock();require(Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000,'Invalid batch clock.');return value;}

/** Sequential only. No retries, app writes, finalization, resume calls or global duplicate ledger. */
export async function runBatch({manifest,outputDirectory,maxJobs,provider=syntheticProvider,timeoutMs=30000,clock=Date.now}={}){
 const normalized=normalizeManifest(manifest,maxJobs),providerMetadata=metadataFor(provider);
 require(Number.isInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=120000,'Invalid review timeout.');
 require(typeof outputDirectory==='string'&&outputDirectory.trim().length>0,'Specify a new output directory.');
 require(typeof clock==='function','Supply a batch clock.');
 const initialTime=timestamp(clock),simulation=provider.kind==='synthetic';
 for(const job of normalized.jobs){
  require(Date.parse(job.capturedAt)<=initialTime,'A captured job cannot be from the future.');
  if(simulation)require(new URL(job.url).hostname.endsWith('.invalid')&&job.content.startsWith('SYNTHETIC'),'Simulation requires explicitly labelled .invalid fixtures.');
 }
 const output=resolve(outputDirectory);
 require(!existsSync(output),'Output directory already exists; no evaluation was started.');
 // Exclusive directory creation also rejects races and broken symlinks before any provider call.
 mkdirSync(output,{mode:0o700});
 const batchId=randomUUID(),manifestHash=hash(normalized),startedAt=new Date(initialTime).toISOString();
 write(join(output,'manifest.json'),normalized);
 write(join(output,'run.json'),{kind:'10x.ai-review-batch-run.v1',batchId,manifestHash,startedAt,maxJobs,jobCount:normalized.jobs.length,provider:providerMetadata,simulation,financialExecution:false});
 const outcomes=[];
 for(const [index,job] of normalized.jobs.entries()){
  const prefix=String(index+1).padStart(4,'0'),nowMs=timestamp(clock),inputHash=hash(job);
  write(join(output,prefix+'.started.json'),{kind:'10x.ai-review-started.v1',batchId,submissionId:job.submissionId,inputHash,startedAt:new Date(nowMs).toISOString(),status:'started-outcome-unknown',simulation,financialExecution:false});
  let report;
  try{report=await evaluateSubmission({job,provider,nowMs,timeoutMs});}
  catch{
   // Provider errors may contain secrets, private content or instructions; persist no raw exception.
   const payload={kind:'10x.ai-review-failure.v1',batchId,submissionId:job.submissionId,tokenId:job.tokenId,inputHash,createdAt:new Date(timestamp(clock)).toISOString(),provider:providerMetadata,simulation,status:'evaluation-failed',code:'EVALUATION_FAILED',message:'No score was accepted. Inspect the captured input, provider configuration and request limits before deciding whether to try again.',requiresFinalReview:true,financialExecution:false};
   const artifact=prefix+'.failure.json';
   write(join(output,artifact),{failureId:hash(payload),payload});
   outcomes.push({index:index+1,submissionId:job.submissionId,status:'evaluation-failed',artifact});
   continue;
  }
  // Storage failures abort the run rather than quietly repeating a successful provider call.
  const artifact=prefix+'.report.json';write(join(output,artifact),report);
  outcomes.push({index:index+1,submissionId:job.submissionId,status:'review-suggested',artifact});
 }
 const summary={kind:'10x.ai-review-batch-summary.v1',batchId,manifestHash,startedAt,completedAt:new Date(timestamp(clock)).toISOString(),jobCount:outcomes.length,suggested:outcomes.filter(o=>o.status==='review-suggested').length,failed:outcomes.filter(o=>o.status==='evaluation-failed').length,simulation,financialExecution:false,outcomes};
 write(join(output,'summary.json'),summary);
 return summary;
}

const usage=`Bounded local review batch (fixture provider is the default):
  node platform/ai-review/batch.mjs --input work/ai-batch.json --out work/review-run-001 --max-jobs 10
  node platform/ai-review/batch.mjs --provider openai --allow-paid-provider --model APPROVED_MODEL_ID --input work/ai-batch.json --out work/review-run-002 --max-jobs 10
The exact manifest is {"kind":"10x.ai-review-batch.v1","jobs":[capturedJob,...]}.
--max-jobs is required, 1–25. Inputs are at most 1 MiB. The output directory must not exist.
There are no retries, automatic resume, finalization or app database writes. Failed jobs leave safe receipts and do not stop later jobs.`;

export async function runBatchCli(args){
 if(args.length===0||(args.length===1&&args[0]==='--help')){console.log(usage);return;}
 const options={},allowed=new Set(['input','out','max-jobs','provider','allow-paid-provider','model','max-output-tokens']);
 for(let index=0;index<args.length;index++){
  const flag=args[index];require(flag.startsWith('--'),'Expected a batch option.');const key=flag.slice(2);
  require(allowed.has(key)&&!Object.hasOwn(options,key),'Unknown or repeated batch option.');
  if(key==='allow-paid-provider')options[key]=true;
  else{const value=args[++index];require(typeof value==='string'&&value.length>0&&!value.startsWith('--'),'Missing batch option value.');options[key]=value;}
 }
 require(typeof options['max-jobs']==='string'&&/^(?:[1-9]|1[0-9]|2[0-5])$/.test(options['max-jobs']),'Specify --max-jobs from 1 to 25.');
 const mode=options.provider??'fixture';require(['fixture','openai'].includes(mode),'Choose fixture or openai provider.');
 if(mode==='fixture')require(!options['allow-paid-provider']&&!options.model&&!options['max-output-tokens'],'Paid-provider options require --provider openai.');
 else require(options['allow-paid-provider']===true,'OpenAI scoring requires explicit --allow-paid-provider consent.');
 const manifest=readBatchManifest(options.input);
 // Reading credentials/configuration creates no request; runBatch completes all job/path checks first.
 const provider=mode==='fixture'?syntheticProvider:createOpenAIProvider({apiKey:process.env.OPENAI_API_KEY,model:options.model??process.env.OPENAI_REVIEW_MODEL,allowPaidProvider:true,maxOutputTokens:options['max-output-tokens']===undefined?4096:Number(options['max-output-tokens'])});
 const summary=await runBatch({manifest,outputDirectory:options.out,maxJobs:Number(options['max-jobs']),provider,timeoutMs:mode==='openai'?60000:30000});
 console.log(JSON.stringify({outputDirectory:resolve(options.out),batchId:summary.batchId,jobCount:summary.jobCount,suggested:summary.suggested,failed:summary.failed,simulation:summary.simulation,financialExecution:false}));
 return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runBatchCli(process.argv.slice(2)).then(summary=>{if(summary?.failed)process.exitCode=2;}).catch(error=>{console.error(error.message);process.exitCode=1;});
