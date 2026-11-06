import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOperatorCommand,dispatchOperatorCommand,LOCAL_OPERATOR_COMMANDS,LOCAL_OPERATOR_SCOPES,operatorCommandScope} from '../application/operator-commands.mjs';
import {createOperationsCommand,OPERATIONS} from '../storage/atomic-operations.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {FINAL_REVIEW,reviewRequestBytes} from '../application/commands.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';

const crypto=createNodeCrypto(),nowMs=Date.parse('2026-11-07T04:00:00Z'),epoch=Math.floor(nowMs/86400000);
const principal={kind:'operator',id:'synthetic-local-operator'};
const revisions={earn:'0',source:'12',control:'3'};
const staffing=()=>({operationKind:OPERATIONS.configureWorkload,requestKey:'synthetic-staffing',expectedRevisions:{...revisions},
 input:{effectiveEpoch:epoch,staffedMinutes:5,secondsPerReview:45,admissionLimit:50,reason:'Synthetic staffed pilot'}});
const pause=()=>({operationKind:OPERATIONS.changeScope,requestKey:'synthetic-pause',expectedRevisions:{...revisions},
 input:{scope:'earn-admission',paused:true,previousRevision:null,reason:'Synthetic pause',evidenceRef:'synthetic:operator-preview'}});
const review=()=>({operationKind:FINAL_REVIEW,requestKey:'synthetic-submission',expectedRevisions:{...revisions},
 input:{submissionId:'synthetic-submission',score:7,reason:'Synthetic final moderation',sourceRef:'synthetic:review'}});
const prepare=request=>prepareOperatorCommand({principal,request,nowMs},crypto);
const invalid=error=>error.code==='invalid_input';

test('local operator registry rejects member authority, extra fields, unknown commands and incomplete revisions before hashing',async()=>{
 let hashes=0;const counting={...crypto,async sha256(bytes){hashes++;return crypto.sha256(bytes);}};
 const bad=[{...staffing(),actor:'injected'},{...staffing(),nowMs}, {...staffing(),operationKind:OPERATIONS.reserveOptionalCost},
  {...staffing(),requestKey:'bad key'}, {...staffing(),expectedRevisions:{earn:'0',source:'12'}},
  {...staffing(),expectedRevisions:{...revisions,other:'1'}}, {...staffing(),expectedRevisions:{...revisions,control:3}},
  {...staffing(),expectedRevisions:{...revisions,control:'03'}}, {...staffing(),expectedRevisions:{...revisions,control:'9007199254740992'}},
  {...staffing(),input:{...staffing().input,limit:99}}];
 for(const request of bad)await assert.rejects(prepareOperatorCommand({principal,request,nowMs},counting),invalid);
 for(const badPrincipal of [{kind:'wallet',wallet:'synthetic'}, {...principal,sessionToken:'not-command-data'}, {kind:'operator',id:' '}])
  await assert.rejects(prepareOperatorCommand({principal:badPrincipal,request:staffing(),nowMs},counting),invalid);
 await assert.rejects(prepareOperatorCommand({principal,request:staffing(),nowMs:NaN},counting),invalid);
 assert.equal(hashes,0);assert.deepEqual(LOCAL_OPERATOR_COMMANDS,[OPERATIONS.configureWorkload,OPERATIONS.changeScope,FINAL_REVIEW]);
});

test('final moderation keeps historical receipt identity while confirmation binds explicit revisions',async()=>{
 const request=review(),value=await prepare(request),changed=await prepare({...request,expectedRevisions:{...revisions,source:'13'}}),later=await prepareOperatorCommand({principal,request,nowMs:nowMs+86400000},crypto);
 assert.equal(value.command.requestDigest,await crypto.sha256(reviewRequestBytes({principal,input:request.input})));
 assert.equal(value.command.businessIdentity,request.input.submissionId);assert.equal(value.command.requestKey,request.input.submissionId);
 assert.equal(changed.command.requestDigest,value.command.requestDigest);assert.equal(later.command.requestDigest,value.command.requestDigest);
 assert.notEqual(changed.preview.confirmationDigest,value.preview.confirmationDigest);assert.equal(later.preview.confirmationDigest,value.preview.confirmationDigest);
 assert.deepEqual(value.preview.summary,{...request.input,final:true});assert.equal(Object.isFrozen(value.preview.summary),true);
 for(const score of [-1,11,1.5,'7'])await assert.rejects(prepare({...request,input:{...request.input,score}}),invalid);
 for(const bad of [{...request,requestKey:'different'}, {...request,input:{...request.input,final:true}}, {...request,input:{...request.input,sourceRef:''}}, {...request,input:{...request.input,submissionId:''}}])await assert.rejects(prepare(bad),invalid);
});

test('all confirmation identities bind canonical captured request, principal, revisions and key',async()=>{
 for(const request of [staffing(),pause(),review()]){
  const value=await prepare(request),expected=await crypto.sha256(utf8(canonicalJson(['10x-local-operator-confirmation-v1',principal.id,request])));assert.equal(value.preview.confirmationDigest,expected);
  const changedRevision=await prepare({...request,expectedRevisions:{...revisions,earn:'1'}});assert.notEqual(changedRevision.preview.confirmationDigest,expected);
  const other=await prepareOperatorCommand({principal:{...principal,id:'another-operator'},request,nowMs},crypto);assert.notEqual(other.preview.confirmationDigest,expected);
  const changed=request.operationKind===FINAL_REVIEW?{...request,requestKey:'other-submission',input:{...request.input,submissionId:'other-submission'}}:{...request,requestKey:'other-key'};
  assert.notEqual((await prepare(changed)).preview.confirmationDigest,expected);
 }
 // Scope receipt identity excludes requestKey; confirmation must still bind it.
 const a=await prepare(pause()),b=await prepare({...pause(),requestKey:'another-pause-key'});assert.equal(a.command.requestDigest,b.command.requestDigest);assert.notEqual(a.preview.confirmationDigest,b.preview.confirmationDigest);
});

test('final moderation dispatch is optional, named and requires its distinct operator scope',async()=>{
 const value=await prepare(review()),result={kind:'replayed',receipt:{operationId:'synthetic-final'},value:{recorded:true,replayed:true}};let captured;
 assert.throws(()=>dispatchOperatorCommand({},value),invalid);
 assert.equal(await dispatchOperatorCommand({recordFinalReview(command){captured=command;return Promise.resolve(result);}},value),result);assert.equal(captured,value.command);
 assert.equal(operatorCommandScope(FINAL_REVIEW),'earn-review');assert.equal(operatorCommandScope(OPERATIONS.configureWorkload),'operations');assert.equal(operatorCommandScope(OPERATIONS.changeScope),'operations');
 assert.equal(Object.isFrozen(LOCAL_OPERATOR_SCOPES),true);assert.throws(()=>operatorCommandScope('unknown'),invalid);
});

test('preview validates economic and protected-scope bounds without inventing current authority',async()=>{
 for(const input of [{...staffing().input,effectiveEpoch:-1},{...staffing().input,staffedMinutes:1441},
  {...staffing().input,staffedMinutes:0.5},{...staffing().input,secondsPerReview:0}, {...staffing().input,secondsPerReview:3601},
  {...staffing().input,admissionLimit:101},{...staffing().input,reason:' x '}])await assert.rejects(prepare({...staffing(),input}),invalid);
 for(const input of [{...pause().input,scope:'operation-recovery'},{...pause().input,scope:'vault-claim'},
  {...pause().input,paused:1},{...pause().input,previousRevision:''},{...pause().input,evidenceRef:''}])await assert.rejects(prepare({...pause(),input}),invalid);
 const value=await prepare(staffing());assert.equal(value.preview.summary.calculatedCapacity,6);assert.equal(value.preview.financialExecution,false);
 assert.deepEqual(value.preview.expectedRevisions,revisions);assert.equal(value.preview.requestDigest,value.command.requestDigest);
 assert.equal(value.preview.summary.currentOrFutureEpoch,true);
 assert.equal((await prepare({...staffing(),input:{...staffing().input,staffedMinutes:0}})).preview.summary.calculatedCapacity,0);
 const p=await prepare(pause());assert.deepEqual(p.preview.summary,pause().input);assert.equal(p.preview.financialExecution,false);
});

test('command identity matches existing atomic operations and survives later retry time',async()=>{
 const request=staffing(),first=await prepare(request),later=await prepareOperatorCommand({principal,request,nowMs:nowMs+2*86400000},crypto);
 const existing=await createOperationsCommand(request.operationKind,{principal,requestKey:request.requestKey,input:request.input,expectedRevisions:request.expectedRevisions,nowMs},crypto);
 assert.deepEqual(first.command,existing);assert.equal(first.command.requestDigest,later.command.requestDigest);
 assert.equal(later.preview.summary.currentOrFutureEpoch,false);assert.notEqual(first.command.nowMs,later.command.nowMs);
 for(const changed of [{...request,input:{...request.input,admissionLimit:49}}, {...request,expectedRevisions:{...revisions,control:'4'}}])
  assert.notEqual((await prepare(changed)).command.requestDigest,first.command.requestDigest);
});

test('operator principal, revisions and input are captured before asynchronous hashing and the result is deeply immutable',async()=>{
 let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
 const delayed={...crypto,async sha256(bytes){started();await gate;return crypto.sha256(bytes);}},p={...principal},request=staffing(),original=structuredClone(request);
 const pending=prepareOperatorCommand({principal:p,request,nowMs},delayed);await entered;
 p.id='different';request.input.staffedMinutes=1400;request.expectedRevisions.source='99';request.operationKind=OPERATIONS.changeScope;release();
 const result=await pending,expected=await prepare(original);assert.deepEqual(result,expected);
 for(const value of [result,result.command,result.command.input,result.command.principal,result.command.expectedRevisions,result.preview,result.preview.summary,result.preview.expectedRevisions])assert.equal(Object.isFrozen(value),true);
 assert.throws(()=>{result.command.input.staffedMinutes=2;},TypeError);assert.throws(()=>{result.preview.financialExecution=true;},TypeError);
});

test('dispatch invokes only the named repository methods and preserves receipt/replay outcomes',async()=>{
 const calls=[],accepted=Object.freeze({kind:'replayed',receipt:{operationId:'synthetic-existing'},value:{limit:6}}),repo={
  configureWorkload(command){calls.push(['staffing',command]);return Promise.resolve(accepted);},
  changeScope(command){calls.push(['scope',command]);return Promise.resolve({kind:'conflict',code:'revision_conflict'});}};
 const old=await prepareOperatorCommand({principal,request:staffing(),nowMs:nowMs+86400000},crypto);
 assert.equal(await dispatchOperatorCommand(repo,old),accepted);const scope=await prepare(pause());assert.deepEqual(await dispatchOperatorCommand(repo,scope),{kind:'conflict',code:'revision_conflict'});
 assert.deepEqual(calls,[['staffing',old.command],['scope',scope.command]]);
 assert.throws(()=>dispatchOperatorCommand(repo,{command:{operationKind:'arbitrary-sql'}}),invalid);assert.equal(calls.length,2);
});
