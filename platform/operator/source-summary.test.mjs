import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCollectionSourceResult,projectCollectionSourceOutcome} from './source-summary.mjs';
import {prepareOperatorCommand,dispatchOperatorCommand,operatorCommandScope} from '../application/operator-commands.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
const id='a'.repeat(64),digest='b'.repeat(64),wallet='synthetic-private-wallet';
test('source summaries retain only counts and commitments, never wallet bounds or retained payloads',()=>{
 const list={id,count:3,pageIds:[digest],walletsDigest:digest,closureDigest:digest,firstWallet:wallet,lastWallet:wallet,bytes:'private'};
 assert.deepEqual(projectCollectionSourceResult('collection.seal-list.v1',list),{id,count:3,pageCount:1,walletsDigest:digest,closureDigest:digest,visibility:'private-staging'});
 const source={id,inventoryId:'synthetic',sourceRevision:'1',declaredStateDigest:digest,stageCount:1,admissionCount:0,closureDigest:digest,verification:'record-closure-only',semanticStateDigestVerified:false,economicsVerified:false,provenanceVerified:false,stageBindings:[{private:wallet}],admissionPageIds:[wallet],listIds:[wallet]};
 assert.ok(!JSON.stringify(projectCollectionSourceResult('collection.seal-source.v1',source)).includes(wallet));
 const receipt={outputDigest:digest},result=projectCollectionSourceOutcome('collection.seal-list.v1',{kind:'replayed',receipt,value:list});assert.equal(result.receipt,receipt);assert.equal(result.projection,'safe-source-summary-v1');assert.ok(!JSON.stringify(result).includes(wallet));
 const held={kind:'pending',reason:'missing-evidence'};assert.equal(projectCollectionSourceOutcome('collection.seal-list.v1',held),held);assert.throws(()=>projectCollectionSourceResult('unknown',list));
});
test('source registry requires exact named identity/revisions and dispatches only the declared operation',async()=>{
 const crypto=createNodeCrypto(),principal={kind:'operator',id:'synthetic-source-operator'};
 for(const [operationKind,method] of [['collection.seal-list.v1','sealList'],['collection.seal-source.v1','sealSource'],['collection.materialize-eligibility-page.v1','materializePage']]){
  const request={operationKind,requestKey:'source-request',input:{id},expectedRevisions:{earn:'1',source:'2',control:'3'}},p=await prepareOperatorCommand({principal,request,nowMs:1},crypto);assert.equal(operatorCommandScope(operationKind),'collection-import');assert.deepEqual(p.preview.summary,{id,financialExecution:false,privateStaging:true});
  const later=await prepareOperatorCommand({principal,request,nowMs:2},crypto);assert.equal(p.command.requestDigest,later.command.requestDigest);let called=false;await dispatchOperatorCommand({[method]:async command=>{assert.equal(command,p.command);called=true;}},p);assert.equal(called,true);
  const changed=structuredClone(request);changed.expectedRevisions.source='3';assert.notEqual((await prepareOperatorCommand({principal,request:changed,nowMs:1},crypto)).command.requestDigest,p.command.requestDigest);
  await assert.rejects(prepareOperatorCommand({principal,request:{...request,input:{id,entries:[wallet]}},nowMs:1},crypto));
 }
});
