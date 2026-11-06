/** Descriptive local review artifact only. This module grants no authority and
 * deliberately never serializes the request or arbitrary preview properties. */
export const OPERATOR_APPROVAL_PACKET_MAX_BYTES=16384;
const STAFF='ops.configure-workload.v1',SCOPE='ops.change-scope.v1',REVIEW='earn.final-review.v1',STAGE='collection.publish-stage.v1',BALLOT='governance.publish-ballot.v1',DECISION='governance.record-decision.v1',BEGIN='collection.begin-free-cut.v1',PAGE='collection.validate-cut-page.v1',SEAL='collection.seal-free-cut.v1';
const fail=()=>{throw new TypeError('Invalid operator approval preview.');};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
const field=(v,k)=>{if(!plain(v))fail();const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!Object.hasOwn(d,'value'))fail();return d.value;};
const exact=(v,keys)=>{if(!plain(v)||Object.keys(v).length!==keys.length||!keys.every(k=>Object.hasOwn(v,k)))fail();};
const text=(v,max=256)=>typeof v==='string'&&v.length>0&&v.length<=max&&v===v.trim();
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const nat=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const time=v=>nat(v,8640000000000000);
const revision=v=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v));
const money=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n;
const bool=v=>typeof v==='boolean';
const isNull=v=>v===null;
const fixed=value=>v=>v===value;
const scope=v=>['launch-preparation','earn-admission','collection-mint','collection-progression','optional-refresh','optional-images','optional-notifications'].includes(v);
const INPUTS=Object.freeze({
 [STAFF]:{effectiveEpoch:nat,staffedMinutes:v=>nat(v,1440),secondsPerReview:v=>nat(v,3600)&&v>=1,admissionLimit:v=>nat(v,100),reason:text},
 [SCOPE]:{scope,paused:bool,previousRevision:v=>v===null||text(v),reason:text,evidenceRef:text},
 [REVIEW]:{submissionId:text,score:v=>nat(v,10),reason:text,sourceRef:text},
 [STAGE]:{inventoryId:id,stageId:id,type:fixed('whitelist'),publishedAt:time,opensAt:time,closesAt:time,priceLamports:money,costLamports:money,allocation:v=>nat(v,1000)&&v>0,walletLimit:v=>nat(v,1000)&&v>0,founderApproved:fixed(false),approvedSpendLamports:isNull,ballotId:isNull,inventoryOverrideReason:isNull,eligibilityListId:hex,sourceKind:fixed('synthetic-local-operator-fixture')},
 [BALLOT]:{ballotId:id,opensMs:time,previousTrancheOpeningMs:time,electorateSourceId:id,electorateDigest:hex,cutoffMs:time,sourceKind:fixed('synthetic-local-operator-fixture'),holdersListId:hex,nextWhitelistListId:hex,unionListId:hex},
 [DECISION]:{ballotId:id,choice:v=>['ASAP','7','14','30'].includes(v),decidedMs:time,noticeMs:time,rationale:v=>text(v,1000)},
 [BEGIN]:{rootId:hex},[PAGE]:{attemptId:hex,pageIndex:v=>nat(v,99)},[SEAL]:{attemptId:hex}
});
function select(value,schema){const out={};for(const [key,validate] of Object.entries(schema)){const v=field(value,key);if(!validate(v))fail();out[key]=v;}return out;}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function cutSummary(kind,input,summary){
 const context=select(field(summary,'context'),{inventoryId:id,stageId:id,cutMs:time,termsDigest:hex,eligibilityListId:hex,pageCount:v=>nat(v,100)&&v>0});
 const common={attemptId:hex,source:fixed('local-fixture'),executable:fixed(false)},schema=kind===BEGIN?{...common,rootId:hex,sourceRevision:revision,inventoryId:id,stageId:id,atMs:time}:kind===PAGE?{...common,pageIndex:v=>nat(v,99),pageId:hex,holdingCount:v=>nat(v,100),trackedCount:v=>nat(v,100),closureDigest:hex}:{...common,inventoryId:id,stageId:id,atMs:time,rootId:hex,eligibilityListId:hex,eligibleWallets:v=>nat(v,10000),commitmentKind:fixed('paged-fixed-cut-v1')};
 const result=select(field(summary,'result'),schema);
 if(field(summary,'financialExecution')!==false)fail();
 if(kind===PAGE){if(result.attemptId!==input.attemptId||result.pageIndex!==input.pageIndex||result.pageIndex>=context.pageCount)fail();}
 else if(result.inventoryId!==context.inventoryId||result.stageId!==context.stageId||result.atMs!==context.cutMs||kind===BEGIN&&result.rootId!==input.rootId||kind===SEAL&&(result.attemptId!==input.attemptId||result.eligibilityListId!==context.eligibilityListId))fail();
 return {...input,financialExecution:false,context,result};
}
/** Inputs must be an already validated, unsubmitted console preview. Digests are
 * retained identities, not independently recomputed signatures or authorization. */
export function createOperatorApprovalPacket({request,preview}){
 exact(request,['operationKind','requestKey','input','expectedRevisions']);
 const operationKind=field(request,'operationKind'),requestKey=field(request,'requestKey');
 if(!Object.hasOwn(INPUTS,operationKind)||!id(requestKey)||field(preview,'operationKind')!==operationKind||field(preview,'requestKey')!==requestKey||field(preview,'financialExecution')!==false)fail();
 const requestDigest=field(preview,'requestDigest'),confirmationDigest=field(preview,'confirmationDigest');if(!hex(requestDigest)||!hex(confirmationDigest))fail();
 const revisions=field(request,'expectedRevisions'),previewRevisions=field(preview,'expectedRevisions');exact(revisions,['earn','source','control']);exact(previewRevisions,['earn','source','control']);const expectedRevisions=select(revisions,{earn:revision,source:revision,control:revision});for(const key of Object.keys(expectedRevisions))if(field(previewRevisions,key)!==expectedRevisions[key])fail();
 const raw=field(request,'input'),rawSummary=field(preview,'summary'),schema=INPUTS[operationKind];exact(raw,Object.keys(schema));const input=select(raw,schema);for(const [key,value] of Object.entries(input))if(field(rawSummary,key)!==value)fail();
 let summary={...input};
 if(operationKind===STAFF){Object.assign(summary,select(rawSummary,{calculatedCapacity:v=>nat(v,100),currentOrFutureEpoch:bool}));if(summary.calculatedCapacity!==Math.min(input.admissionLimit,Math.floor(input.staffedMinutes*60/input.secondsPerReview)))fail();}
 else if(operationKind===REVIEW){Object.assign(summary,select(rawSummary,{final:fixed(true)}));if(requestKey!==input.submissionId)fail();}
 else if(operationKind===STAGE){const eligibility=select(field(rawSummary,'eligibility'),{kind:fixed('list'),listId:hex,count:v=>nat(v,10000)});if(eligibility.listId!==input.eligibilityListId||input.closesAt<=input.opensAt)fail();Object.assign(summary,select(rawSummary,{termsDigest:hex,costUncertainty:v=>text(v,1000)}),{eligibility});}
 else if(operationKind===BALLOT){Object.assign(summary,select(rawSummary,{advisory:fixed(true),financialExecution:fixed(false),snapshotHash:hex,eligibleCount:v=>nat(v,10000),closesAt:time}));if(input.cutoffMs!==input.opensMs||summary.closesAt!==input.opensMs+172800000)fail();}
 else if(operationKind===DECISION){Object.assign(summary,select(rawSummary,{advisory:fixed(true),financialExecution:fixed(false),earliestMs:time,ballotSnapshotHash:hex}));if(summary.earliestMs<input.decidedMs||summary.earliestMs<input.noticeMs+172800000)fail();}
 else if([BEGIN,PAGE,SEAL].includes(operationKind))summary=cutSummary(operationKind,input,rawSummary);
 const packet={format:'10x.local.operator-approval.v1',source:'local-fixture',financialExecution:false,isAuthorization:false,operationKind,requestKey,requestDigest,confirmationDigest,expectedRevisions,summary};
 if(new TextEncoder().encode(JSON.stringify(packet)).length>OPERATOR_APPROVAL_PACKET_MAX_BYTES)fail();return freeze(packet);
}
