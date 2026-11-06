/** Descriptive local review artifact only. This module grants no authority and
 * deliberately never serializes the request or arbitrary preview properties. */
export const OPERATOR_APPROVAL_PACKET_MAX_BYTES=16384;
const OBSERVE='collection.observe-asset.v1',UPLOAD_SOURCE='collection.stage-record.v1',UPLOAD_CUT='collection.stage-cut-record.v1',STAFF='ops.configure-workload.v1',ACTION='earn.configure-action.v1',SEAL_LIST='collection.seal-list.v1',SEAL_SOURCE='collection.seal-source.v1',INDEX_PAGE='collection.materialize-eligibility-page.v1',SCOPE='ops.change-scope.v1',REVIEW='earn.final-review.v1',STAGE='collection.publish-stage.v1',BALLOT='governance.publish-ballot.v1',DECISION='governance.record-decision.v1',BEGIN='collection.begin-free-cut.v1',PAGE='collection.validate-cut-page.v1',SEAL='collection.seal-free-cut.v1';
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
const wallet=v=>{if(typeof v!=='string'||v.length<32||v.length>44)return false;const chars='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=0n;for(const c of v){const i=chars.indexOf(c);if(i<0)return false;n=n*58n+BigInt(i);}let bytes=0;while(n){bytes++;n>>=8n;}return bytes+(v.match(/^1*/)?.[0].length??0)===32;};
const INPUTS=Object.freeze({
 [OBSERVE]:{assetId:id,kind:v=>['transfer','reveal'].includes(v),from:v=>v===null||wallet(v),to:v=>v===null||wallet(v),observedMs:time,expectedAssetVersion:nat,evidenceReceiptId:hex,evidenceDigest:hex},
 [UPLOAD_SOURCE]:{id:hex,size:v=>nat(v,131072)&&v>0},[UPLOAD_CUT]:{id:hex,size:v=>nat(v,65536)&&v>0},
 [SEAL_LIST]:{id:hex},[SEAL_SOURCE]:{id:hex},[INDEX_PAGE]:{id:hex},
 [ACTION]:{actionId:text,label:text,verifier:text,effectiveEpoch:nat,enabled:bool,evidenceRef:text},
 [STAFF]:{effectiveEpoch:nat,staffedMinutes:v=>nat(v,1440),secondsPerReview:v=>nat(v,3600)&&v>=1,admissionLimit:v=>nat(v,100),reason:text},
 [SCOPE]:{scope,paused:bool,previousRevision:v=>v===null||text(v),reason:text,evidenceRef:text},
 [REVIEW]:{submissionId:text,score:v=>nat(v,10),reason:text,sourceRef:text},
 [STAGE]:{inventoryId:id,stageId:id,type:v=>['whitelist','free','public','founder'].includes(v),publishedAt:time,opensAt:time,closesAt:time,priceLamports:money,costLamports:money,allocation:v=>nat(v,1000)&&v>0,walletLimit:v=>v===null||nat(v,1000)&&v>0,founderApproved:bool,approvedSpendLamports:v=>v===null||money(v),ballotId:v=>v===null||id(v),inventoryOverrideReason:v=>v===null||text(v,500),eligibilityListId:v=>v===null||hex(v),sourceKind:fixed('synthetic-local-operator-fixture')},
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
function openingSummary(input,raw){
 const out=select(raw,{applicable:bool,firstStageId:v=>v===null||id(v),ballotId:v=>v===null||id(v),previousInventoryId:v=>v===null||id(v),previousTranche:v=>v===null||nat(v,1000)&&v>0,previousAdmitted:v=>v===null||nat(v,1000),previousRemaining:v=>v===null||nat(v,1000),decisionStatus:v=>['missing','recorded'].includes(v),decisionEarliestMs:v=>v===null||time(v),defaultPostponed:bool,inventoryOverrideReason:v=>v===null||text(v,500),effectiveEarliestMs:v=>v===null||time(v),financialExecution:fixed(false)});
 const holds=field(raw,'holds'),allowed=['stage-not-open','decision-missing','decision-not-due','previous-inventory-missing','previous-inventory-remaining'];if(!Array.isArray(holds)||holds.length>5||new Set(holds).size!==holds.length||holds.some(v=>!allowed.includes(v)))fail();out.holds=[...holds];
 if((out.previousAdmitted===null)!==(out.previousRemaining===null)||out.previousAdmitted!==null&&out.previousAdmitted+out.previousRemaining!==1000||(out.decisionStatus==='missing')!==(out.decisionEarliestMs===null)||out.applicable&&out.firstStageId===null||!out.applicable&&(out.holds.length||out.defaultPostponed||out.effectiveEarliestMs!==null)||out.applicable&&out.decisionStatus==='recorded'&&out.effectiveEarliestMs!==Math.max(input.opensAt,out.decisionEarliestMs)||out.applicable&&out.decisionStatus==='missing'&&(out.effectiveEarliestMs!==null||!out.holds.includes('decision-missing'))||out.inventoryOverrideReason!==null&&out.holds.includes('previous-inventory-remaining'))fail();
 if(out.firstStageId===input.stageId){if(out.ballotId!==input.ballotId||out.inventoryOverrideReason!==input.inventoryOverrideReason)fail();}else if(input.ballotId!==null||input.inventoryOverrideReason!==null)fail();
 return out;
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
 if([UPLOAD_SOURCE,UPLOAD_CUT].includes(operationKind)){Object.assign(summary,select(rawSummary,{format:v=>(operationKind===UPLOAD_SOURCE?['collection-page-v1','collection-list-v1','collection-source-v1']:['collection-cut-page-v1','collection-cut-root-v1']).includes(v),privateStaging:fixed(true),financialExecution:fixed(false)}));}
 else if([SEAL_LIST,SEAL_SOURCE,INDEX_PAGE].includes(operationKind)){
  Object.assign(summary,select(rawSummary,{privateStaging:fixed(true),financialExecution:fixed(false)}));
  const schema=operationKind===SEAL_LIST?{id:hex,count:v=>nat(v,10000),pageCount:v=>nat(v,100)&&v>0,walletsDigest:hex,closureDigest:hex,visibility:fixed('private-staging')}:operationKind===INDEX_PAGE?{id:hex,entryCount:v=>nat(v,100),visibility:fixed('private-staging')}:{id:hex,inventoryId:id,sourceRevision:revision,declaredStateDigest:hex,stageCount:v=>nat(v,32),admissionCount:v=>nat(v,1000),closureDigest:hex,verification:fixed('record-closure-only'),semanticStateDigestVerified:fixed(false),economicsVerified:fixed(false),provenanceVerified:fixed(false)};
  summary.result=select(field(rawSummary,'result'),schema);if(summary.result.id!==input.id||operationKind===SEAL_LIST&&summary.result.pageCount!==Math.max(1,Math.ceil(summary.result.count/100)))fail();
 }
 else if(operationKind===OBSERVE){
  if(input.kind==='reveal'?(input.from!==null||input.to!==null):(!wallet(input.from)||!wallet(input.to)||input.from===input.to||input.observedMs%1000!==0))fail();
  Object.assign(summary,select(rawSummary,{fixtureOnly:fixed(true),financialExecution:fixed(false)}));
  summary.result=select(field(rawSummary,'result'),{sourceId:id,assetId:id,kind:fixed(input.kind),observedMs:fixed(input.observedMs),revealMs:v=>v===null||time(v),assetVersion:nat,resultKind:v=>['applied','held'].includes(v),conflictId:v=>v===null||id(v),operationId:v=>v===null||id(v),evidenceReceiptId:fixed(input.evidenceReceiptId),source:fixed('local-fixture'),executable:fixed(false)});
  const r=summary.result;if(r.assetId!==input.assetId||r.assetVersion!==input.expectedAssetVersion+(input.kind==='transfer'?1:0)||(input.kind==='reveal'&&r.revealMs!==input.observedMs)||(r.resultKind==='held'?(input.kind!=='transfer'||r.conflictId===null||r.operationId===null):(r.conflictId!==null||r.operationId!==null)))fail();
 }
 else if(operationKind===ACTION){Object.assign(summary,select(rawSummary,{futureOnly:fixed(true),financialExecution:fixed(false)}));}
 else if(operationKind===STAFF){Object.assign(summary,select(rawSummary,{calculatedCapacity:v=>nat(v,100),currentOrFutureEpoch:bool}));if(summary.calculatedCapacity!==Math.min(input.admissionLimit,Math.floor(input.staffedMinutes*60/input.secondsPerReview)))fail();}
 else if(operationKind===REVIEW){Object.assign(summary,select(rawSummary,{final:fixed(true)}));if(requestKey!==input.submissionId)fail();}
 else if(operationKind===STAGE){
  const listed=['whitelist','founder'].includes(input.type),founder=['public','founder'].includes(input.type),eligibility=select(field(rawSummary,'eligibility'),{kind:fixed(listed?'list':input.type==='free'?'pending':'unrestricted'),listId:listed?hex:isNull,count:listed?v=>nat(v,10000):isNull});
  if(eligibility.listId!==input.eligibilityListId||input.closesAt<=input.opensAt||input.founderApproved!==founder||(['free','founder'].includes(input.type)&&input.priceLamports!=='0')||(input.type==='founder'?!money(input.approvedSpendLamports):input.approvedSpendLamports!==null))fail();
  Object.assign(summary,select(rawSummary,{termsDigest:hex,costUncertainty:v=>text(v,1000)}),{eligibility,opening:openingSummary(input,field(rawSummary,'opening'))});
 }
 else if(operationKind===BALLOT){Object.assign(summary,select(rawSummary,{advisory:fixed(true),financialExecution:fixed(false),snapshotHash:hex,eligibleCount:v=>nat(v,10000),closesAt:time}));if(input.cutoffMs!==input.opensMs||summary.closesAt!==input.opensMs+172800000)fail();}
 else if(operationKind===DECISION){Object.assign(summary,select(rawSummary,{advisory:fixed(true),financialExecution:fixed(false),earliestMs:time,ballotSnapshotHash:hex}));if(summary.earliestMs<input.decidedMs||summary.earliestMs<input.noticeMs+172800000)fail();}
 else if([BEGIN,PAGE,SEAL].includes(operationKind))summary=cutSummary(operationKind,input,rawSummary);
 const packet={...([UPLOAD_SOURCE,UPLOAD_CUT].includes(operationKind)?{requestIdentity:'upload-metadata'}:{}),format:'10x.local.operator-approval.v1',source:'local-fixture',financialExecution:false,isAuthorization:false,operationKind,requestKey,requestDigest,confirmationDigest,expectedRevisions,summary};
 if(new TextEncoder().encode(JSON.stringify(packet)).length>OPERATOR_APPROVAL_PACKET_MAX_BYTES)fail();return freeze(packet);
}
