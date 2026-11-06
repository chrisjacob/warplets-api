import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorApprovalPacket,OPERATOR_APPROVAL_PACKET_MAX_BYTES} from './approval-packet.mjs';
import {prepareOperatorCommand} from '../application/operator-commands.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {controlledScopes} from '../operations/portable-controls.mjs';
const crypto=createNodeCrypto(),now=1800000000000,day=86400000,principal={kind:'operator',id:'synthetic-packet-operator'},digest=n=>n.repeat(64),revisions={earn:'1',source:'2',control:'3'};
const cases=[
 ['ops.configure-workload.v1',{effectiveEpoch:Math.floor(now/day),staffedMinutes:60,secondsPerReview:45,admissionLimit:100,reason:'Synthetic staffing'},{}],
 ['ops.change-scope.v1',{scope:'earn-admission',paused:true,previousRevision:null,reason:'Synthetic pause',evidenceRef:'synthetic:control'},{}],
 ['earn.final-review.v1',{submissionId:'synthetic-submission',score:8,reason:'Synthetic content review',sourceRef:'synthetic:evidence'},{}],
 ['collection.publish-stage.v1',{inventoryId:'synthetic-inventory',stageId:'synthetic-whitelist',type:'whitelist',publishedAt:now,opensAt:now+2*day,closesAt:now+3*day,priceLamports:'100000000',costLamports:'5000',allocation:100,walletLimit:2,founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:digest('a'),sourceKind:'synthetic-local-operator-fixture'},{termsDigest:digest('b'),eligibility:{kind:'list',listId:digest('a'),count:2},costUncertainty:'Local estimate only; network and total cost are unknown.'}],
 ['governance.publish-ballot.v1',{ballotId:'synthetic-ballot',opensMs:now,previousTrancheOpeningMs:now-day,electorateSourceId:'synthetic-source',electorateDigest:digest('b'),cutoffMs:now,sourceKind:'synthetic-local-operator-fixture',holdersListId:digest('c'),nextWhitelistListId:digest('d'),unionListId:digest('e')},{snapshotHash:digest('f'),eligibleCount:2,closesAt:now+2*day}],
 ['governance.record-decision.v1',{ballotId:'synthetic-ballot',choice:'7',decidedMs:now,noticeMs:now-day,rationale:'Synthetic advisory decision'},{earliestMs:now+day,ballotSnapshotHash:digest('f')}],
 ['collection.begin-free-cut.v1',{rootId:digest('a')},{result:{attemptId:digest('b'),rootId:digest('a'),sourceRevision:'2',inventoryId:'synthetic-inventory',stageId:'synthetic-free',atMs:now,source:'local-fixture',executable:false}}],
 ['collection.validate-cut-page.v1',{attemptId:digest('b'),pageIndex:0},{result:{attemptId:digest('b'),pageIndex:0,pageId:digest('c'),holdingCount:2,trackedCount:2,closureDigest:digest('d'),source:'local-fixture',executable:false}}],
 ['collection.seal-free-cut.v1',{attemptId:digest('b')},{result:{attemptId:digest('b'),rootId:digest('a'),inventoryId:'synthetic-inventory',stageId:'synthetic-free',atMs:now,eligibilityListId:digest('e'),eligibleWallets:2,commitmentKind:'paged-fixed-cut-v1',source:'local-fixture',executable:false}}]
];
async function pair(index){const [operationKind,input,derived]=structuredClone(cases[index]),request={operationKind,requestKey:index===2?input.submissionId:'synthetic-packet-'+index,expectedRevisions:{...revisions},input},prepared=await prepareOperatorCommand({principal,request,nowMs:now},crypto),preview=structuredClone(prepared.preview);Object.assign(preview.summary,derived);if(index>=6)preview.summary.context={inventoryId:'synthetic-inventory',stageId:'synthetic-free',cutMs:now,termsDigest:digest('f'),eligibilityListId:digest('e'),pageCount:1};return {request,preview};}
test('nine supported previews produce immutable bounded review-only packets with exact retained identities',async()=>{
 for(let index=0;index<cases.length;index++){const value=await pair(index),packet=createOperatorApprovalPacket(value);assert.equal(packet.format,'10x.local.operator-approval.v1');assert.equal(packet.source,'local-fixture');assert.equal(packet.financialExecution,false);assert.equal(packet.isAuthorization,false);for(const key of ['operationKind','requestKey','requestDigest','confirmationDigest'])assert.equal(packet[key],value.preview[key]);assert.deepEqual(packet.expectedRevisions,revisions);assert.deepEqual(JSON.parse(JSON.stringify(packet)),packet);assert.ok(new TextEncoder().encode(JSON.stringify(packet)).length<=OPERATOR_APPROVAL_PACKET_MAX_BYTES);assert.equal(Object.hasOwn(packet,'request'),false);assert.equal(Object.hasOwn(packet,'input'),false);assert.equal(Object.isFrozen(packet.summary),true);value.request.expectedRevisions.source='9';value.preview.summary.reason='Changed';assert.deepEqual(packet.expectedRevisions,revisions);assert.notEqual(packet.summary.reason,'Changed');}
});
test('private nested extras, tokens, raw records, wallets and hidden asset internals never enter a packet',async()=>{
 for(let index=0;index<cases.length;index++){const value=await pair(index),expected=createOperatorApprovalPacket(value),secret={wallets:['PRIVATE_WALLET'],asset:{hiddenOutcome:'PRIVATE_LEVEL',traits:['PRIVATE_TRAIT']},sourceRecords:[{bytes:'PRIVATE_BYTES'}],token:'PRIVATE_BEARER'};
  Object.assign(value.preview,secret);Object.assign(value.preview.summary,secret);for(const key of ['context','result','eligibility'])if(value.preview.summary[key])Object.assign(value.preview.summary[key],secret);Object.defineProperty(value.preview,'unusedCredential',{get(){throw Error('must not inspect unselected extra');}});
  const packet=createOperatorApprovalPacket(value);assert.deepEqual(packet,expected);assert.ok(!JSON.stringify(packet).includes('PRIVATE_'));
 }
});
test('request, input, revisions and preview identity mismatches fail closed without exporting',async()=>{
 const mutations=[v=>v.preview.operationKind='unknown',v=>v.preview.requestKey='other-key',v=>v.preview.requestDigest='A'.repeat(64),v=>delete v.preview.confirmationDigest,v=>v.preview.financialExecution=true,v=>v.preview.expectedRevisions.source='3',v=>v.request.expectedRevisions.source='02',v=>v.request.expectedRevisions.extra='1',v=>v.request.token='secret',v=>v.request.input.extra='secret',v=>v.preview.summary.reason='Different',v=>v.preview.summary.calculatedCapacity=99,v=>v.preview.summary.currentOrFutureEpoch='true',v=>v.request.operationKind='toString'];
 for(const change of mutations){const v=await pair(0);change(v);assert.throws(()=>createOperatorApprovalPacket(v),TypeError);}
 const selectedGetter=await pair(0);Object.defineProperty(selectedGetter.preview,'requestDigest',{get(){throw Error('getter must not execute');}});assert.throws(()=>createOperatorApprovalPacket(selectedGetter),TypeError);
});
test('all current controllable scopes are supported while protected or malformed scope grants are not',async()=>{
 for(const scope of controlledScopes){const v=await pair(1);v.request.input.scope=v.preview.summary.scope=scope;assert.equal(createOperatorApprovalPacket(v).summary.scope,scope);}
 for(const scope of ['vault-claim','operation-recovery','optional-notification']){const v=await pair(1);v.request.input.scope=v.preview.summary.scope=scope;assert.throws(()=>createOperatorApprovalPacket(v),TypeError);}
});
test('derived publication, decision, review and cut fields bind their exact reviewed context',async()=>{
 const mutations=[[2,v=>v.preview.summary.final=false],[2,v=>v.request.requestKey=v.preview.requestKey='other'],[3,v=>v.preview.summary.eligibility.listId=digest('f')],[3,v=>v.preview.summary.eligibility.count=10001],[3,v=>v.preview.summary.termsDigest='x'],[3,v=>v.preview.summary.costUncertainty={token:'secret'}],[4,v=>v.preview.summary.closesAt++],[4,v=>v.request.input.cutoffMs=v.preview.summary.cutoffMs=now+1],[4,v=>v.preview.summary.advisory=false],[5,v=>v.preview.summary.earliestMs=now],[5,v=>v.preview.summary.ballotSnapshotHash=null],[6,v=>v.preview.summary.result.rootId=digest('f')],[6,v=>v.preview.summary.context.cutMs++],[7,v=>v.preview.summary.result.pageIndex=1],[7,v=>v.preview.summary.result.trackedCount=101],[8,v=>v.preview.summary.result.eligibilityListId=digest('f')],[8,v=>v.preview.summary.result.executable=true],[8,v=>v.preview.summary.result.source='verified-chain'],[8,v=>v.preview.summary.context.pageCount=0]];
 for(const [index,change] of mutations){const value=await pair(index);change(value);assert.throws(()=>createOperatorApprovalPacket(value),TypeError,index+': '+change);}
});
test('bounded strings and scalar types reject oversized or nested payloads instead of deep passthrough',async()=>{
 for(const value of ['x'.repeat(1001),['private'],{secret:'private'},null,undefined]){const v=await pair(5);v.request.input.rationale=v.preview.summary.rationale=value;assert.throws(()=>createOperatorApprovalPacket(v),TypeError);}
 const valid=await pair(5);valid.request.input.rationale=valid.preview.summary.rationale='😀'.repeat(500);assert.ok(new TextEncoder().encode(JSON.stringify(createOperatorApprovalPacket(valid))).length<OPERATOR_APPROVAL_PACKET_MAX_BYTES);
 const amount=await pair(3);amount.request.input.priceLamports=amount.preview.summary.priceLamports='18446744073709551616';assert.throws(()=>createOperatorApprovalPacket(amount),TypeError);
});
