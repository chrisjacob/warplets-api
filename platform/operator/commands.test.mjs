import {CONFIGURE_ACTION} from '../earn/action-policy-service.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOperatorCommand,dispatchOperatorCommand,LOCAL_OPERATOR_COMMANDS,LOCAL_OPERATOR_SCOPES,operatorCommandScope} from '../application/operator-commands.mjs';
import {createOperationsCommand,OPERATIONS} from '../storage/atomic-operations.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {FINAL_REVIEW,reviewRequestBytes} from '../application/commands.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {buildCollectionCutCommand,STAGE_COLLECTION_CUT_RECORD,BEGIN_COLLECTION_FREE_CUT,VALIDATE_COLLECTION_CUT_PAGE,SEAL_COLLECTION_FREE_CUT} from '../collect/free-cut-service.mjs';
import {PUBLISH_BALLOT,RECORD_DECISION,prepareGovernanceOperatorCommand,governanceOperatorCommandBytes} from '../governance/operator-service.mjs';
import {PUBLISH_COLLECTION_STAGE,buildStagePublicationCommand} from '../collect/stage-service.mjs';

const crypto=createNodeCrypto(),nowMs=Date.parse('2026-11-07T04:00:00Z'),epoch=Math.floor(nowMs/86400000);
const principal={kind:'operator',id:'synthetic-local-operator'};
const revisions={earn:'0',source:'12',control:'3'};
const staffing=()=>({operationKind:OPERATIONS.configureWorkload,requestKey:'synthetic-staffing',expectedRevisions:{...revisions},
 input:{effectiveEpoch:epoch,staffedMinutes:5,secondsPerReview:45,admissionLimit:50,reason:'Synthetic staffed pilot'}});
const pause=()=>({operationKind:OPERATIONS.changeScope,requestKey:'synthetic-pause',expectedRevisions:{...revisions},
 input:{scope:'earn-admission',paused:true,previousRevision:null,reason:'Synthetic pause',evidenceRef:'synthetic:operator-preview'}});
const review=()=>({operationKind:FINAL_REVIEW,requestKey:'synthetic-submission',expectedRevisions:{...revisions},
 input:{submissionId:'synthetic-submission',score:7,reason:'Synthetic final moderation',sourceRef:'synthetic:review'}});
const stage=()=>({operationKind:PUBLISH_COLLECTION_STAGE,requestKey:'synthetic-stage',expectedRevisions:{...revisions},input:{
 inventoryId:'synthetic-inventory',stageId:'synthetic-whitelist',type:'whitelist',publishedAt:nowMs,opensAt:nowMs+2*86400000,closesAt:nowMs+3*86400000,
 priceLamports:'100000000',costLamports:'5000',allocation:100,walletLimit:1,founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:'a'.repeat(64),sourceKind:'synthetic-local-operator-fixture'}});
const ballot=()=>({operationKind:PUBLISH_BALLOT,requestKey:'synthetic-ballot-publish',expectedRevisions:{...revisions},input:{ballotId:'synthetic-ballot',opensMs:nowMs,previousTrancheOpeningMs:nowMs-86400000,electorateSourceId:'synthetic-electorate',electorateDigest:'b'.repeat(64),cutoffMs:nowMs,sourceKind:'synthetic-local-operator-fixture',holdersListId:'c'.repeat(64),nextWhitelistListId:'d'.repeat(64),unionListId:'e'.repeat(64)}});
const decision=()=>({operationKind:RECORD_DECISION,requestKey:'synthetic-decision',expectedRevisions:{...revisions},input:{ballotId:'synthetic-ballot',choice:'7',decidedMs:nowMs,noticeMs:nowMs-86400000,rationale:'Synthetic advisory choice'}});
const cutBegin=()=>({operationKind:BEGIN_COLLECTION_FREE_CUT,requestKey:'synthetic-cut-begin',expectedRevisions:{...revisions},input:{rootId:'a'.repeat(64)}});
const cutPage=()=>({operationKind:VALIDATE_COLLECTION_CUT_PAGE,requestKey:'synthetic-cut-page',expectedRevisions:{...revisions},input:{attemptId:'b'.repeat(64),pageIndex:0}});
const cutSeal=()=>({operationKind:SEAL_COLLECTION_FREE_CUT,requestKey:'synthetic-cut-seal',expectedRevisions:{...revisions},input:{attemptId:'b'.repeat(64)}});
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
 assert.equal(hashes,0);assert.deepEqual(LOCAL_OPERATOR_COMMANDS,[CONFIGURE_ACTION,OPERATIONS.configureWorkload,OPERATIONS.changeScope,FINAL_REVIEW,PUBLISH_COLLECTION_STAGE,PUBLISH_BALLOT,RECORD_DECISION,BEGIN_COLLECTION_FREE_CUT,VALIDATE_COLLECTION_CUT_PAGE,SEAL_COLLECTION_FREE_CUT]);
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
 for(const request of [staffing(),pause(),review(),stage(),ballot(),decision(),cutBegin(),cutPage(),cutSeal()]){
  const value=await prepare(request),expected=await crypto.sha256(utf8(canonicalJson(['10x-local-operator-confirmation-v1',principal.id,request])));assert.equal(value.preview.confirmationDigest,expected);
  const changedRevision=await prepare({...request,expectedRevisions:{...revisions,earn:'1'}});assert.notEqual(changedRevision.preview.confirmationDigest,expected);
  const other=await prepareOperatorCommand({principal:{...principal,id:'another-operator'},request,nowMs},crypto);assert.notEqual(other.preview.confirmationDigest,expected);
  const changed=request.operationKind===FINAL_REVIEW?{...request,requestKey:'other-submission',input:{...request.input,submissionId:'other-submission'}}:{...request,requestKey:'other-key'};
  assert.notEqual((await prepare(changed)).preview.confirmationDigest,expected);
 }
 // Scope receipt identity excludes requestKey; confirmation must still bind it.
 const a=await prepare(pause()),b=await prepare({...pause(),requestKey:'another-pause-key'});assert.equal(a.command.requestDigest,b.command.requestDigest);assert.notEqual(a.preview.confirmationDigest,b.preview.confirmationDigest);
});

test('whitelist publication preserves historical digest and carries exact reviewed revisions without claiming derived terms',async()=>{
 const request=stage(),prepared=await prepare(request),historical=await buildStagePublicationCommand(principal,{requestKey:request.requestKey,input:request.input},crypto);
 assert.equal(prepared.command.requestDigest,historical.requestDigest);assert.equal(prepared.command.businessIdentity,historical.businessIdentity);assert.deepEqual(prepared.command.expectedRevisions,revisions);
 const changed=await prepare({...request,expectedRevisions:{...revisions,source:'13'}});assert.equal(changed.command.requestDigest,prepared.command.requestDigest);assert.notEqual(changed.preview.confirmationDigest,prepared.preview.confirmationDigest);
 assert.deepEqual(prepared.preview.summary,request.input);assert.equal(prepared.preview.financialExecution,false);assert.equal(Object.hasOwn(prepared.preview.summary,'termsDigest'),false);assert.equal(Object.hasOwn(prepared.preview.summary,'eligibleCount'),false);
 assert.equal(operatorCommandScope(PUBLISH_COLLECTION_STAGE),'collection-publication');assert.throws(()=>dispatchOperatorCommand({},prepared),invalid);
 const accepted={kind:'replayed',receipt:{operationId:'synthetic-stage-receipt'},value:{executable:false}};let seen;
 assert.equal(await dispatchOperatorCommand({publishStage(command){seen=command;return Promise.resolve(accepted);}},prepared),accepted);assert.equal(seen,prepared.command);
 for(const input of [{...request.input,type:'public',eligibilityListId:null},{...request.input,type:'free',eligibilityListId:null},{...request.input,type:'founder'},
  {...request.input,founderApproved:true},{...request.input,approvedSpendLamports:'1'},{...request.input,inventoryOverrideReason:'explicit override'},{...request.input,ballotId:'synthetic-ballot'}])await assert.rejects(prepare({...request,input}),invalid);
 for(const input of [{...request.input,extra:true},{...request.input,eligibilityListId:'invalid'},{...request.input,priceLamports:'-1'}])await assert.rejects(prepare({...request,input}));
 await assert.rejects(prepare({...request,expectedRevisions:{earn:'0',source:'12'}}),invalid);
});

test('whitelist input and confirmation remain immutable across awaited stage command hashing',async()=>{
 let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
 const request=stage(),original=structuredClone(request),p={...principal},delayed={...crypto,async sha256(bytes){started();await gate;return crypto.sha256(bytes);}};
 const pending=prepareOperatorCommand({principal:p,request,nowMs},delayed);await entered;request.input.priceLamports='999';request.input.eligibilityListId='b'.repeat(64);request.expectedRevisions.source='99';p.id='other';release();
 const prepared=await pending;assert.deepEqual(prepared,await prepare(original));assert.equal(Object.isFrozen(prepared.command.input),true);assert.equal(Object.isFrozen(prepared.preview.summary),true);
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


test('advisory governance preserves historical command identity and exposes no derived or execution authority',async()=>{
 for(const request of [ballot(),decision()]){
  const prepared=await prepare(request),historical=await prepareGovernanceOperatorCommand(request.operationKind,{principal,input:request.input,requestKey:request.requestKey,expectedRevisions:revisions,nowMs},crypto);
  assert.deepEqual(prepared.command,historical);assert.equal(prepared.command.requestDigest,await crypto.sha256(governanceOperatorCommandBytes(historical)));
  const later=await prepareOperatorCommand({principal,request,nowMs:nowMs+86400000},crypto),changed=await prepare({...request,requestKey:'different-key',expectedRevisions:{...revisions,source:'99'}});
  assert.equal(later.command.requestDigest,historical.requestDigest);assert.equal(changed.command.requestDigest,historical.requestDigest);assert.equal(later.preview.confirmationDigest,prepared.preview.confirmationDigest);assert.notEqual(changed.preview.confirmationDigest,prepared.preview.confirmationDigest);
  assert.deepEqual(prepared.preview.summary,{...request.input,advisory:true,financialExecution:false});assert.equal(prepared.preview.financialExecution,false);
  for(const key of ['snapshotHash','eligibleCount','closesAt','earliestMs','approvedSpendLamports','stageOpening'])assert.equal(Object.hasOwn(prepared.preview.summary,key),false);
  const method=request.operationKind===PUBLISH_BALLOT?'publishBallot':'recordDecision',scope=request.operationKind===PUBLISH_BALLOT?'governance-publication':'governance-decision';
  assert.equal(operatorCommandScope(request.operationKind),scope);assert.throws(()=>dispatchOperatorCommand({},prepared),invalid);
  let seen;const accepted={kind:'replayed',value:{executable:false}};assert.equal(await dispatchOperatorCommand({[method](command){seen=command;return Promise.resolve(accepted);}},prepared),accepted);assert.equal(seen,prepared.command);
 }
});

test('governance registry rejects injected authority and malformed exact inputs before hashing',async()=>{
 let hashes=0;const counting={...crypto,async sha256(bytes){hashes++;return crypto.sha256(bytes);}};
 const invalidInputs=[
  {...ballot(),input:{...ballot().input,sourceKind:'chain-verified'}}, {...ballot(),input:{...ballot().input,cutoffMs:nowMs-1}},
  {...ballot(),input:{...ballot().input,holdersListId:'bad'}}, {...ballot(),input:{...ballot().input,electorateDigest:'bad'}},
  {...ballot(),input:{...ballot().input,ballotId:'invalid ballot'}}, {...ballot(),input:{...ballot().input,opensMs:-1}},
  {...decision(),input:{...decision().input,choice:'90'}}, {...decision(),input:{...decision().input,rationale:''}},
  {...decision(),input:{...decision().input,decidedMs:1.5}}, {...decision(),input:{...decision().input,noticeMs:-1}}
 ];
 for(const base of [ballot(),decision()]){
  for(const key of Object.keys(base.input)){const input={...base.input};delete input[key];invalidInputs.push({...base,input});}
  for(const field of ['advisory','earliestMs','approvedSpendLamports','founderApproved','stageOpening','snapshotHash'])invalidInputs.push({...base,input:{...base.input,[field]:true}});
  invalidInputs.push({...base,expectedRevisions:{earn:'0',source:'12'}});
 }
 for(const request of invalidInputs)await assert.rejects(prepareOperatorCommand({principal,request,nowMs},counting));
 assert.equal(hashes,0);
});

test('governance input, principal and full confirmation stay captured across asynchronous historical hashing',async()=>{
 for(const factory of [ballot,decision]){
  let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
  const request=factory(),original=structuredClone(request),p={...principal},delayed={...crypto,async sha256(bytes){started();await gate;return crypto.sha256(bytes);}};
  const pending=prepareOperatorCommand({principal:p,request,nowMs},delayed);await entered;
  request.input.ballotId='another-ballot';request.expectedRevisions.control='99';request.requestKey='another-key';p.id='another-operator';release();
  const prepared=await pending;assert.deepEqual(prepared,await prepare(original));
  for(const value of [prepared.command,prepared.command.input,prepared.command.principal,prepared.command.expectedRevisions,prepared.preview,prepared.preview.summary])assert.equal(Object.isFrozen(value),true);
 }
});


test('fixed-cut registry preserves historical digests, exact static inputs and three distinct named dispatches',async()=>{
 for(const [factory,method] of [[cutBegin,'beginCut'],[cutPage,'validatePage'],[cutSeal,'sealCut']]){
  const request=factory(),prepared=await prepare(request),legacy=await buildCollectionCutCommand(request.operationKind,principal,{requestKey:request.requestKey,...request.input},crypto);
  assert.equal(prepared.command.requestDigest,legacy.requestDigest);assert.equal(prepared.command.businessIdentity,legacy.businessIdentity);assert.deepEqual(prepared.command.expectedRevisions,revisions);
  const changed=await prepare({...request,expectedRevisions:{...revisions,control:'4'}}),later=await prepareOperatorCommand({principal,request,nowMs:nowMs+86400000},crypto);
  assert.equal(changed.command.requestDigest,legacy.requestDigest);assert.notEqual(changed.preview.confirmationDigest,prepared.preview.confirmationDigest);assert.deepEqual(later,prepared);
  assert.deepEqual(prepared.preview.summary,{...request.input,financialExecution:false});assert.equal(prepared.preview.financialExecution,false);assert.equal(operatorCommandScope(request.operationKind),'collection-evidence');
  for(const field of ['inventoryId','stageId','cutMs','termsDigest','eligibilityListId','pageCount','wallets','result'])assert.equal(Object.hasOwn(prepared.preview.summary,field),false);
  assert.throws(()=>dispatchOperatorCommand({},prepared),invalid);const accepted={kind:'replayed',value:{source:'local-fixture',executable:false}};let seen;
  assert.equal(await dispatchOperatorCommand({[method](command){seen=command;return Promise.resolve(accepted);}},prepared),accepted);assert.equal(seen,prepared.command);
 }
 for(const pageIndex of [0,99])assert.equal((await prepare({...cutPage(),input:{...cutPage().input,pageIndex}})).command.input.pageIndex,pageIndex);
});

test('fixed-cut input bounds reject caller timing, lists, record uploads, aliases and noncanonical identities before hashing',async()=>{
 let hashes=0;const counting={...crypto,async sha256(bytes){hashes++;return crypto.sha256(bytes);}},bad=[];
 for(const factory of [cutBegin,cutPage,cutSeal]){
  const request=factory(),id=request.operationKind===BEGIN_COLLECTION_FREE_CUT?'rootId':'attemptId';
  for(const value of ['', 'a'.repeat(63),'a'.repeat(65),'A'.repeat(64),'g'.repeat(64),null,7])bad.push({...request,input:{...request.input,[id]:value}});
  for(const field of Object.keys(request.input)){const input={...request.input};delete input[field];bad.push({...request,input});}
  for(const field of ['cutMs','atMs','wallets','sourceRevision','complete','inventoryId','stageId','record','expectedRevisions'])bad.push({...request,input:{...request.input,[field]:field==='wallets'?[]:true}});
  bad.push({...request,expectedRevisions:{earn:'0',source:'12'}});
 }
 for(const pageIndex of [-1,100,0.5,'0',null,NaN,Infinity])bad.push({...cutPage(),input:{...cutPage().input,pageIndex}});
 for(const operationKind of [STAGE_COLLECTION_CUT_RECORD,'beginCut','validatePage','sealCut','collection.freeze-free-cut.v1'])bad.push({...cutBegin(),operationKind});
 for(const request of bad)await assert.rejects(prepareOperatorCommand({principal,request,nowMs},counting));assert.equal(hashes,0);
 assert.equal(LOCAL_OPERATOR_COMMANDS.includes(STAGE_COLLECTION_CUT_RECORD),false);
});

test('fixed-cut request is captured and deeply frozen before either asynchronous digest',async()=>{
 for(const factory of [cutBegin,cutPage,cutSeal]){
  let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
  const request=factory(),original=structuredClone(request),p={...principal},delayed={...crypto,async sha256(bytes){started();await gate;return crypto.sha256(bytes);}};
  const pending=prepareOperatorCommand({principal:p,request,nowMs},delayed);await entered;
  request.input={attemptId:'f'.repeat(64),pageIndex:99};request.requestKey='changed';request.expectedRevisions.source='99';p.id='changed';release();
  const prepared=await pending;assert.deepEqual(prepared,await prepare(original));
  for(const value of [prepared.command,prepared.command.input,prepared.command.principal,prepared.command.expectedRevisions,prepared.preview,prepared.preview.summary])assert.equal(Object.isFrozen(value),true);
 }
});


test('stage registry expands only explicit local free, public and founder approvals while preserving original command identity',async()=>{
 const cases=[
  {...stage().input,type:'free',priceLamports:'0',eligibilityListId:null,walletLimit:null},
  {...stage().input,type:'public',founderApproved:true,eligibilityListId:null},
  {...stage().input,type:'founder',priceLamports:'0',founderApproved:true,approvedSpendLamports:'0'},
  {...stage().input,type:'founder',priceLamports:'0',founderApproved:true,approvedSpendLamports:'1000000'}
 ];
 for(const input of cases){
  const request={...stage(),input},prepared=await prepare(request),original=await buildStagePublicationCommand(principal,{input,requestKey:request.requestKey},crypto);
  assert.equal(prepared.command.requestDigest,original.requestDigest);assert.equal(prepared.command.businessIdentity,original.businessIdentity);assert.deepEqual(prepared.preview.summary,input);assert.equal(prepared.preview.financialExecution,false);assert.equal(operatorCommandScope(request.operationKind),'collection-publication');
  assert.equal(Object.hasOwn(prepared.preview.summary,'eligibleCount'),false);assert.equal(Object.hasOwn(prepared.preview.summary,'termsDigest'),false);
  const revised=await prepare({...request,expectedRevisions:{...revisions,control:'4'}});assert.equal(revised.command.requestDigest,original.requestDigest);assert.notEqual(revised.preview.confirmationDigest,prepared.preview.confirmationDigest);
  const later=await prepareOperatorCommand({principal,request,nowMs:nowMs+86400000},crypto);assert.deepEqual(later,prepared);
 }
 const founder=cases.at(-1),a=await prepare({...stage(),input:founder}),b=await prepare({...stage(),input:{...founder,approvedSpendLamports:'1000001'}});assert.notEqual(a.command.requestDigest,b.command.requestDigest);assert.notEqual(a.preview.confirmationDigest,b.preview.confirmationDigest);
 const publicInput=cases[1],publicPreview=await prepare({...stage(),input:publicInput}),whitelistPreview=await prepare(stage());assert.notEqual(publicPreview.preview.confirmationDigest,whitelistPreview.preview.confirmationDigest);
});

test('stage approval combinations reject inferred founder authority, extra budgets, invalid prices and unavailable ballot or override lanes',async()=>{
 let hashes=0;const counting={...crypto,async sha256(bytes){hashes++;return crypto.sha256(bytes);}},base=stage().input;
 const inputs=[
  {...base,founderApproved:true}, {...base,approvedSpendLamports:'0'},
  {...base,type:'free',priceLamports:'0',eligibilityListId:null,founderApproved:true}, {...base,type:'free',priceLamports:'0',eligibilityListId:null,approvedSpendLamports:'0'},
  {...base,type:'free',priceLamports:'1',eligibilityListId:null}, {...base,type:'free',priceLamports:'0'},
  {...base,type:'public',eligibilityListId:null}, {...base,type:'public',eligibilityListId:null,founderApproved:true,approvedSpendLamports:'0'}, {...base,type:'public',founderApproved:true},
  {...base,type:'founder',priceLamports:'0',approvedSpendLamports:'0'}, {...base,type:'founder',priceLamports:'0',founderApproved:true}, {...base,type:'founder',priceLamports:'1',founderApproved:true,approvedSpendLamports:'0'},
  {...base,type:'founder',priceLamports:'0',founderApproved:true,approvedSpendLamports:'0',eligibilityListId:null}
 ];
 for(const approvedSpendLamports of ['-1','01','18446744073709551616',0])inputs.push({...base,type:'founder',priceLamports:'0',founderApproved:true,approvedSpendLamports});
 for(const type of ['whitelist','free','public','founder']){
  const input={...base,type,priceLamports:['free','founder'].includes(type)?'0':base.priceLamports,founderApproved:['public','founder'].includes(type),approvedSpendLamports:type==='founder'?'0':null,eligibilityListId:['public','free'].includes(type)?null:base.eligibilityListId};
  inputs.push({...input,ballotId:'synthetic-ballot'},{...input,inventoryOverrideReason:'synthetic override'},{...input,spendAuthorized:true});
 }
 for(const input of inputs)await assert.rejects(prepareOperatorCommand({principal,request:{...stage(),input},nowMs},counting));assert.equal(hashes,0);
});

test('action policy registry binds exact future configuration and keeps accepted retry identity independent of time',async()=>{
 const request={operationKind:CONFIGURE_ACTION,requestKey:'synthetic-policy',expectedRevisions:{earn:'1',source:'2',control:'3'},input:{actionId:'synthetic-read',label:'Synthetic guide',verifier:'synthetic-verifier',effectiveEpoch:21000,enabled:true,evidenceRef:'synthetic-policy'}};
 const principal={kind:'operator',id:'synthetic-policy-operator'},crypto=createNodeCrypto(),a=await prepareOperatorCommand({principal,request,nowMs:1},crypto),b=await prepareOperatorCommand({principal,request,nowMs:22000*86400000},crypto);
 assert.equal(a.command.requestDigest,b.command.requestDigest);assert.equal(a.preview.confirmationDigest,b.preview.confirmationDigest);assert.equal(a.preview.summary.futureOnly,true);assert.equal(operatorCommandScope(CONFIGURE_ACTION),'earn-action-policy');
 const changed=structuredClone(request);changed.input.enabled=false;const next=await prepareOperatorCommand({principal,request:changed,nowMs:1},crypto);assert.notEqual(a.command.requestDigest,next.command.requestDigest);assert.notEqual(a.preview.confirmationDigest,next.preview.confirmationDigest);
 await assert.rejects(prepareOperatorCommand({principal,request:{...request,input:{...request.input,issuer:'untrusted'}},nowMs:1},crypto));
 let received;assert.equal(await dispatchOperatorCommand({configureAction:async c=>{received=c;return 'named-dispatch';}},a),'named-dispatch');assert.equal(received,a.command);
});
