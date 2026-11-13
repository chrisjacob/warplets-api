import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAIProvider} from './openai-provider.mjs';
import {evaluateSubmission,creatorFeedback,draftFinalReviewInput} from './review.mjs';
import {exampleJob,syntheticProvider} from './fixture.mjs';
const nowMs=Date.parse(exampleJob.capturedAt)+1000;
const valid=await syntheticProvider.evaluate({untrustedData:{content:exampleJob.content}});
const result=()=>({id:'resp_synthetic_contract_test',model:'approved-model-snapshot',status:'completed',error:null,incomplete_details:null,usage:{input_tokens:400,output_tokens:300,total_tokens:700},output:[{type:'reasoning',summary:[]},{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(valid)}]}]});
const configured=fetchImpl=>createOpenAIProvider({apiKey:'synthetic-secret-never-real',model:'approved-model-snapshot',allowPaidProvider:true,fetchImpl});
const run=provider=>evaluateSubmission({job:exampleJob,provider,nowMs});
test('real adapter requires explicit opt-in, key and chosen model before transport',()=>{
 let calls=0;const fetchImpl=()=>{calls++;};
 assert.throws(()=>createOpenAIProvider({apiKey:'secret',model:'model',fetchImpl}),/allow-paid-provider/);
 assert.throws(()=>createOpenAIProvider({allowPaidProvider:true,model:'model',fetchImpl}),/OPENAI_API_KEY/);
 assert.throws(()=>createOpenAIProvider({allowPaidProvider:true,apiKey:'secret',fetchImpl}),/approved model/);
 assert.throws(()=>createOpenAIProvider({allowPaidProvider:true,apiKey:'secret',model:'model',maxOutputTokens:99999,fetchImpl}),/Output limit/);
 assert.equal(calls,0);
});
test('Responses request is fixed-origin, tool-free, strict-schema and bounded, preserving only safe receipt data',async()=>{
 let calls=0;
 const provider=configured(async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(options.redirect,'error');const body=JSON.parse(options.body);assert.equal(body.store,false);assert.deepEqual(body.tools,[]);assert.equal(body.tool_choice,'none');assert.equal(body.max_output_tokens,4096);assert.equal(body.text.format.type,'json_schema');assert.equal(body.text.format.strict,true);assert.equal(body.text.format.schema.additionalProperties,false);assert.equal(body.input.length,1);assert.equal(Object.hasOwn(JSON.parse(body.input[0].content[0].text).untrustedData,'wallet'),false);return Response.json(result(),{headers:{'x-request-id':'req_synthetic_contract_test'}});});
 const report=await run(provider);assert.equal(calls,1);assert.equal(report.payload.simulation,false);assert.equal(report.payload.providerEvidence.resolvedModel,'approved-model-snapshot');assert.equal(report.payload.providerEvidence.totalTokens,700);assert.equal(JSON.stringify(report).includes('synthetic-secret-never-real'),false);assert.equal(Object.hasOwn(report.payload,'systemPrompt'),false);assert.equal(creatorFeedback(report).simulation,false);
 assert.throws(()=>draftFinalReviewInput(report),/Explicit/);assert.equal(draftFinalReviewInput(report,{decision:'accept-suggestion'}).submissionId,exampleJob.submissionId);
});
test('provider refusals, incomplete output, missing provenance and attempted tool calls cannot become scores',async()=>{
 for(const mutate of [v=>v.status='incomplete',v=>v.incomplete_details={reason:'max_output_tokens'},v=>v.output[1].content=[{type:'refusal',refusal:'not exposed'}],v=>v.output.push({type:'function_call'}),v=>delete v.usage,v=>v.output[1].content.push({type:'output_text',text:'{}'}),v=>v.output[1].content[0].text='not-json']){
  const v=result();mutate(v);let calls=0;await assert.rejects(run(configured(async()=>{calls++;return Response.json(v);})));assert.equal(calls,1,'No automatic retry');
 }
});
test('transport errors are sanitized and large responses are rejected',async()=>{
 await assert.rejects(run(configured(async()=>{throw Error('synthetic-secret-never-real');})),e=>!e.message.includes('synthetic-secret-never-real'));
 await assert.rejects(run(configured(async()=>new Response('sensitive provider error',{status:429}))),e=>e.message.includes('HTTP 429')&&!e.message.includes('sensitive'));
 await assert.rejects(run(configured(async()=>new Response(' '.repeat(524289)))),/byte limit/);
 await assert.rejects(run(configured(async()=>new Response('{}',{headers:{'content-length':'524289'}}))),/byte limit/);
});

test('concurrent evaluations bind each receipt to its own result even when responses complete out of order',async()=>{
 const pending=[];let bothStarted;const ready=new Promise(resolve=>{bothStarted=resolve;});
 const provider=configured((_url,options)=>new Promise(resolve=>{pending.push({resolve,body:JSON.parse(options.body)});if(pending.length===2)bothStarted();}));
 const secondJob={...exampleJob,submissionId:'synthetic-second',content:exampleJob.content+' SECOND'};
 const first=run(provider),second=evaluateSubmission({job:secondJob,provider,nowMs});
 await ready;
 for(const entry of [...pending].reverse()){
  const second=JSON.parse(entry.body.input[0].content[0].text).untrustedData.content.endsWith(' SECOND');
  const v=result();v.id=second?'resp_second':'resp_first';v.model=second?'snapshot_second':'snapshot_first';v.usage=second?{input_tokens:123,output_tokens:456,total_tokens:579}:{input_tokens:400,output_tokens:300,total_tokens:700};
  const e=structuredClone(valid);e.summary=second?'Second review explanation':'First review explanation';v.output[1].content[0].text=JSON.stringify(e);
  entry.resolve(Response.json(v,{headers:{'x-request-id':second?'req_second':'req_first'}}));
 }
 const reports=await Promise.all([first,second]);
 assert.deepEqual(reports.map(r=>({submission:r.payload.capturedJob.submissionId,summary:r.payload.evaluation.summary,response:r.payload.providerEvidence.responseId,request:r.payload.providerEvidence.requestId,model:r.payload.providerEvidence.resolvedModel,tokens:r.payload.providerEvidence.totalTokens})),[
  {submission:exampleJob.submissionId,summary:'First review explanation',response:'resp_first',request:'req_first',model:'snapshot_first',tokens:700},
  {submission:'synthetic-second',summary:'Second review explanation',response:'resp_second',request:'req_second',model:'snapshot_second',tokens:579},
 ]);
});
