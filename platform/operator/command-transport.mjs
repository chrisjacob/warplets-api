import {createCollectionCutRepository} from '../collect/free-cut-repository.mjs';
import {BEGIN_COLLECTION_FREE_CUT,VALIDATE_COLLECTION_CUT_PAGE,SEAL_COLLECTION_FREE_CUT} from '../collect/free-cut-service.mjs';
import {createGovernanceOperatorRepository} from '../governance/operator-repository.mjs';
import {PUBLISH_BALLOT,RECORD_DECISION} from '../governance/operator-service.mjs';
import {CollectionPolicyError} from '../domain/collections/policy.mjs';
import {randomUUID} from 'node:crypto';
import {prepareOperatorCommand,dispatchOperatorCommand,operatorCommandScope} from '../application/operator-commands.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createAtomicOperationsRepository} from '../storage/atomic-operations.mjs';
import {createStagePublicationRepository} from '../collect/stage-repository.mjs';
import {PUBLISH_COLLECTION_STAGE} from '../collect/stage-service.mjs';
import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {createAtomicEarnRepository} from '../storage/atomic-earn.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {json,failure} from '../server/api.mjs';
import {EarnError} from '../earn/validation.mjs';
import {OperatorSessionError} from './session.mjs';

export async function readOperatorBody(request){
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new EarnError(415,'media_type','Use application/json.');
 const reader=request.body?.getReader();if(!reader)throw new EarnError(400,'invalid_body','Expected JSON body.');
 let size=0;const parts=[];
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>16384){await reader.cancel();throw new EarnError(413,'body_too_large','Operator body exceeds 16 KiB.');}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body;
 }catch(error){if(error instanceof EarnError)throw error;throw new EarnError(400,'invalid_body','Expected a bounded JSON object.');}
 finally{reader.releaseLock();}
}

// Node loopback only. The synchronous transaction guard is not hosted/D1 auth.
export function createOperatorCommandTransport(db,{sessions,clock=Date.now,crypto=createNodeCrypto(),ids={next:randomUUID}}){
 return async request=>{
  const {hostname,origin,pathname}=new URL(request.url);
  if(!['127.0.0.1','localhost'].includes(hostname))return failure(403,'local_only','Use the local operator origin.');
  if(!['/ops/commands/preview','/ops/commands/execute','/ops/commands/receipt'].includes(pathname))return failure(404,'not_found','Unknown operator command.');
  if(request.method!=='POST')return failure(405,'method_not_allowed','Use POST.',{allow:'POST'});
  if(request.headers.get('origin')!==origin)return failure(403,'invalid_origin','Use the operator origin.');
  try{
   const raw=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
   sessions.authenticate(raw);
   const body=await readOperatorBody(request),authorization=sessions.authorize(raw,body.operationKind);
   const prepared=await prepareOperatorCommand({principal:authorization.principal,request:body,nowMs:clock()},crypto);
   const driver=createNodeAtomicDriver(db,{transactionGuard:authorization.guard});
   const stages=createStagePublicationRepository(driver,{crypto,ids,clock:{nowMs:clock}});
   const governance=createGovernanceOperatorRepository(driver,{crypto,ids,clock:{nowMs:clock}});
   const cuts=createCollectionCutRepository(driver,{crypto,ids,clock:{nowMs:clock}});
   if(pathname.endsWith('/receipt')){
    const result=await createAtomicReceipts(driver,{crypto,ids}).replay(prepared.command);
    return result?json(result,result.kind==='conflict'?409:200):failure(404,'receipt_not_found','No accepted receipt matches this command. No change was executed.');
   }
   if(pathname.endsWith('/preview')){
    const [version,scope]=await driver.batch([
     {sql:'SELECT name,revision FROM app_revisions ORDER BY name',values:[]},
     {sql:"SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope=?",values:[authorization.principal.id,operatorCommandScope(body.operationKind)]},
    ]);
    if(!scope.rows[0]?.enabled)return failure(403,'operator_scope_required','Operator scope is unavailable.');
    const current=Object.fromEntries(version.rows.map(r=>[r.name,String(r.revision)]));
    if(Object.entries(body.expectedRevisions).some(([key,value])=>current[key]!==value))return failure(409,'revision_conflict','Refresh the current configuration before preview.');
    if(prepared.command.operationKind===PUBLISH_COLLECTION_STAGE){
     const derived=await stages.previewStage(prepared.command);
     if(derived.kind!=='preview')return json(derived,derived.kind==='conflict'?409:derived.kind==='pending'?202:200);
     authorization.guard();
     return json({...prepared.preview,summary:{...prepared.preview.summary,termsDigest:derived.value.termsDigest,
      eligibility:derived.value.eligibility,costUncertainty:derived.value.costUncertainty}});
    }
    if([PUBLISH_BALLOT,RECORD_DECISION].includes(prepared.command.operationKind)){
     const derived=await (prepared.command.operationKind===PUBLISH_BALLOT?governance.previewBallot(prepared.command):governance.previewDecision(prepared.command));
     if(derived.kind!=='preview')return json(derived,derived.kind==='conflict'?409:derived.kind==='pending'?202:200);
     authorization.guard();
     const extra=prepared.command.operationKind===PUBLISH_BALLOT?
      {snapshotHash:derived.value.snapshotHash,eligibleCount:derived.value.eligibleCount,closesAt:derived.value.closesAt}:
      {earliestMs:derived.value.earliestMs,ballotSnapshotHash:derived.value.ballotSnapshotHash};
     return json({...prepared.preview,summary:{...prepared.preview.summary,...extra}});
    }
    if([BEGIN_COLLECTION_FREE_CUT,VALIDATE_COLLECTION_CUT_PAGE,SEAL_COLLECTION_FREE_CUT].includes(prepared.command.operationKind)){
     const derived=await cuts.previewCommand(prepared.command);
     if(derived.kind!=='preview')return json(derived,derived.kind==='conflict'?409:derived.kind==='pending'?202:200);
     authorization.guard();
     const {expectedRevisions,context,financialExecution,...result}=derived.value;
     return json({...prepared.preview,summary:{...prepared.preview.summary,context,result}});
    }
    return json(prepared.preview);
   }
   if(request.headers.get('x-operator-preview')!==prepared.preview.confirmationDigest)
    return failure(409,'preview_required','Confirm the exact command preview.');
   const result=await dispatchOperatorCommand({...createAtomicOperationsRepository(driver,{crypto,ids}),recordFinalReview:createAtomicEarnRepository(driver,{crypto,ids}).recordFinalReview,publishStage:stages.publishStage,publishBallot:governance.publishBallot,recordDecision:governance.recordDecision,beginCut:cuts.beginCut,validatePage:cuts.validatePage,sealCut:cuts.sealCut},prepared);
   return json(result,result.kind==='conflict'?409:result.kind==='pending'?202:200);
  }catch(error){
   if(error instanceof EarnError||error instanceof OperatorSessionError)return failure(error.status,error.code,error.message);
   if(error instanceof CollectionPolicyError)return failure(400,error.code,'Invalid local collection command.');
   if(error instanceof TypeError||error instanceof RangeError)return failure(400,'invalid_command','Invalid operator command.');
   return failure(500,'internal_error','Operator command failed.');
  }
 };
}
