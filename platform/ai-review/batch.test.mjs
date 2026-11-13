import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MAX_MANIFEST_BYTES,normalizeManifest,readBatchManifest,runBatch,runBatchCli} from './batch.mjs';
import {exampleJob,syntheticProvider} from './fixture.mjs';
import {verifyReport} from './review.mjs';

const root=()=>mkdtempSync(join(tmpdir(),'tenx-ai-batch-'));
const clock=()=>Date.parse(exampleJob.capturedAt)+1000;
const manifest=()=>({kind:'10x.ai-review-batch.v1',jobs:[1,2,3].map(index=>({...exampleJob,submissionId:'synthetic:'+index,url:'https://qa.invalid/submission/'+index,content:exampleJob.content+' BATCH '+index}))});
const read=path=>JSON.parse(readFileSync(path,'utf8'));

test('batch runs sequentially, preserves successful reports and continues after a sanitized failure without retries',async()=>{
 const folder=root(),output=join(folder,'run'),calls=[];let active=0,maximumActive=0;
 const provider={...syntheticProvider,async evaluate(request,context){
  active++;maximumActive=Math.max(maximumActive,active);calls.push(request.untrustedData.content.at(-1));
  try{await new Promise(resolve=>setImmediate(resolve));if(request.untrustedData.content.endsWith('2'))throw Error('SECRET_KEY and private provider request details');return await syntheticProvider.evaluate(request,context);}finally{active--;}
 }};
 const summary=await runBatch({manifest:manifest(),outputDirectory:output,maxJobs:3,provider,clock});
 assert.deepEqual(calls,['1','2','3']);assert.equal(maximumActive,1);assert.equal(summary.suggested,2);assert.equal(summary.failed,1);assert.equal(summary.simulation,true);assert.equal(summary.financialExecution,false);
 assert.deepEqual(summary.outcomes.map(outcome=>outcome.artifact),['0001.report.json','0002.failure.json','0003.report.json']);
 for(const index of ['0001','0003']){const report=verifyReport(read(join(output,index+'.report.json')));assert.equal(report.payload.simulation,true);assert.equal(report.payload.requiresFinalReview,true);}
 const failure=read(join(output,'0002.failure.json'));assert.equal(failure.payload.code,'EVALUATION_FAILED');assert.equal(failure.payload.submissionId,'synthetic:2');assert.equal(failure.payload.financialExecution,false);assert.equal(Object.hasOwn(failure.payload,'score'),false);
 const artifacts=readdirSync(output).map(name=>readFileSync(join(output,name),'utf8')).join('\n');assert.equal(artifacts.includes('SECRET_KEY'),false);assert.equal(artifacts.includes('private provider request'),false);
 assert.equal(readdirSync(output).filter(name=>name.endsWith('.started.json')).length,3);assert.deepEqual(read(join(output,'summary.json')),summary);
 await assert.rejects(runBatch({manifest:manifest(),outputDirectory:output,maxJobs:3,provider,clock}),/already exists/);assert.deepEqual(calls,['1','2','3']);
});

test('all input and output preflight failures happen before provider invocation or directory creation',async()=>{
 let calls=0;const provider={...syntheticProvider,evaluate:async()=>{calls++;}};
 const invalid=[
  {maxJobs:undefined},{maxJobs:26},{maxJobs:1},
  {manifest:{kind:'10x.ai-review-batch.v1',jobs:[]}},
  {manifest:{...manifest(),unexpected:true}},
  {manifest:{...manifest(),jobs:[exampleJob,exampleJob]}},
  {manifest:{...manifest(),jobs:[exampleJob,{...exampleJob,content:'SYNTHETIC different capture'}]}},
  {manifest:{...manifest(),jobs:[{...exampleJob,projectContext:undefined}]}},
  {manifest:{...manifest(),jobs:[{...exampleJob,capturedAt:new Date(clock()+1).toISOString()}]}},
  {manifest:{...manifest(),jobs:[{...exampleJob,url:'https://real.example/post'}]}},
  {manifest:{...manifest(),jobs:[{...exampleJob,content:'SYNTHETIC '+ 'x'.repeat(MAX_MANIFEST_BYTES)}]}},
 ];
 const folder=root();
 for(const [index,extra] of invalid.entries()){
  const output=join(folder,String(index));await assert.rejects(runBatch({manifest:manifest(),outputDirectory:output,maxJobs:3,provider,clock,...extra}));assert.equal(existsSync(output),false);
 }
 const existing=join(folder,'existing');mkdirSync(existing);await assert.rejects(runBatch({manifest:manifest(),outputDirectory:existing,maxJobs:3,provider,clock}),/already exists/);
 const file=join(folder,'file');writeFileSync(file,'preserve');await assert.rejects(runBatch({manifest:manifest(),outputDirectory:file,maxJobs:3,provider,clock}),/already exists/);assert.equal(readFileSync(file,'utf8'),'preserve');
 assert.equal(calls,0);
});

test('storage failure stops immediately and preserves an unknown started marker instead of retrying or inventing a provider failure',async()=>{
 const output=join(root(),'run');let calls=0;
 const provider={...syntheticProvider,async evaluate(request,context){calls++;writeFileSync(join(output,'0001.report.json'),'existing evidence',{flag:'wx'});return syntheticProvider.evaluate(request,context);}};
 await assert.rejects(runBatch({manifest:manifest(),outputDirectory:output,maxJobs:3,provider,clock}),error=>error.code==='EEXIST');
 assert.equal(calls,1);assert.equal(read(join(output,'0001.started.json')).status,'started-outcome-unknown');assert.equal(readFileSync(join(output,'0001.report.json'),'utf8'),'existing evidence');
 assert.equal(existsSync(join(output,'0001.failure.json')),false);assert.equal(existsSync(join(output,'0002.started.json')),false);assert.equal(existsSync(join(output,'summary.json')),false);
});

test('manifest reader rejects oversized files, invalid UTF-8 and incomplete schema',()=>{
 const folder=root(),oversized=join(folder,'oversized.json'),invalid=join(folder,'invalid.json'),good=join(folder,'good.json');
 writeFileSync(oversized,' '.repeat(MAX_MANIFEST_BYTES+1));assert.throws(()=>readBatchManifest(oversized),/1 MiB/);
 writeFileSync(invalid,Buffer.from([0xff]));assert.throws(()=>readBatchManifest(invalid));
 writeFileSync(good,'\uFEFF'+JSON.stringify(manifest()));assert.equal(normalizeManifest(readBatchManifest(good),3).jobs.length,3);
 assert.throws(()=>normalizeManifest({kind:'10x.ai-review-batch.v1',jobs:[{submissionId:'missing-evidence'}]},1),/exact review job/);
});

test('CLI defaults to local fixtures and rejects implicit bounds, repeated options and accidental paid configuration',()=>{
 const folder=root(),input=join(folder,'manifest.json'),output=join(folder,'run');writeFileSync(input,JSON.stringify(manifest()));
 const call=args=>spawnSync(process.execPath,[fileURLToPath(new URL('./batch.mjs',import.meta.url)),...args],{encoding:'utf8',env:{...process.env,OPENAI_API_KEY:'',OPENAI_REVIEW_MODEL:''}});
 const common=['--input',input,'--out',output];
 const completed=call([...common,'--max-jobs','3']);assert.equal(completed.status,0,completed.stderr);assert.equal(JSON.parse(completed.stdout).simulation,true);assert.equal(read(join(output,'summary.json')).suggested,3);
 for(const args of [common,[...common,'--max-jobs','0'],[...common,'--max-jobs','26'],[...common,'--max-jobs','3','--max-jobs','3'],[...common,'--max-jobs','3','--model','not-approved'],[...common,'--max-jobs','3','--provider','openai']])assert.notEqual(call(args).status,0);
});

test('opted-in OpenAI mode still rejects invalid manifests and existing output before any provider call',async()=>{
 const folder=root(),input=join(folder,'manifest.json'),output=join(folder,'existing');writeFileSync(input,JSON.stringify(manifest()));mkdirSync(output);
 const originalFetch=globalThis.fetch,originalKey=process.env.OPENAI_API_KEY,originalModel=process.env.OPENAI_REVIEW_MODEL;let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('Mock transport must not run');};process.env.OPENAI_API_KEY='synthetic-test-key';process.env.OPENAI_REVIEW_MODEL='approved-test-model';
 try{
  const args=['--provider','openai','--allow-paid-provider','--max-jobs','3','--input',input,'--out',output];
  await assert.rejects(runBatchCli(args),/already exists/);
  writeFileSync(input,JSON.stringify({...manifest(),jobs:[exampleJob,exampleJob]}));await assert.rejects(runBatchCli(args),/Repeated submission/);
  assert.equal(calls,0);
 }finally{globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;if(originalModel===undefined)delete process.env.OPENAI_REVIEW_MODEL;else process.env.OPENAI_REVIEW_MODEL=originalModel;}
});
