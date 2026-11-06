import {randomUUID} from 'node:crypto';
import {STAGE_COLLECTION_RECORD,prepareCollectionRecord,prepareCollectionIntakeCommand,createCollectionSourceIntake} from '../collect/source-intake.mjs';
import {createCollectionSourceRepository} from '../collect/source-repository.mjs';
import {STAGE_COLLECTION_CUT_RECORD,buildCollectionCutCommand} from '../collect/free-cut-service.mjs';
import {prepareCollectionCutRecord} from '../collect/free-cut-codec.mjs';
import {createCollectionCutRepository} from '../collect/free-cut-repository.mjs';
import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {json,failure} from '../server/api.mjs';
import {EarnError} from '../earn/validation.mjs';
import {OperatorSessionError} from './session.mjs';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const bad=(status,code,message)=>{throw new EarnError(status,code,message);};
function metadata(request){
 const raw=request.headers.get('x-operator-upload');
 if(typeof raw!=='string'||raw.length>2048||!/^[\x20-\x7e]+$/.test(raw))bad(400,'invalid_upload_metadata','Supply bounded ASCII upload metadata.');
 let m;try{m=JSON.parse(raw);}catch{bad(400,'invalid_upload_metadata','Supply exact upload metadata.');}
 if(!exact(m,['operationKind','requestKey','id','size','expectedRevisions'])||![STAGE_COLLECTION_RECORD,STAGE_COLLECTION_CUT_RECORD].includes(m.operationKind)||typeof m.requestKey!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(m.requestKey)||typeof m.id!=='string'||!/^[a-f0-9]{64}$/.test(m.id)||!exact(m.expectedRevisions,['earn','source','control'])||Object.values(m.expectedRevisions).some(n=>typeof n!=='string'||!/^(0|[1-9][0-9]*)$/.test(n)||!Number.isSafeInteger(Number(n))))bad(400,'invalid_upload_metadata','Supply exact upload metadata.');
 const limit=m.operationKind===STAGE_COLLECTION_RECORD?131072:65536;
 if(!Number.isSafeInteger(m.size)||m.size<1)bad(400,'invalid_upload_metadata','Supply a positive integer byte size.');
 if(m.size>limit)bad(413,'body_too_large','Upload exceeds the record limit.');
 Object.freeze(m.expectedRevisions);return Object.freeze(m);
}
async function bytes(request,size){
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)!==size))bad(400,'upload_size_mismatch','Upload length must match the reviewed metadata.');
 const reader=request.body?.getReader();if(!reader){if(size===0)return new Uint8Array();bad(400,'upload_size_mismatch','Upload length must match the reviewed metadata.');}
 let total=0;const chunks=[];
 try{
  for(;;){const part=await reader.read();if(part.done)break;if(!(part.value instanceof Uint8Array))bad(400,'invalid_upload','Supply binary record bytes.');total+=part.value.byteLength;
   if(total>size){await reader.cancel();bad(size===0?400:413,size===0?'receipt_body_not_empty':'body_too_large',size===0?'Receipt lookup requires an empty body.':'Upload exceeds the declared byte size.');}
   chunks.push(part.value.slice());
  }
  if(total!==size)bad(400,'upload_size_mismatch','Upload length must match the reviewed metadata.');
  const result=new Uint8Array(total);let offset=0;for(const part of chunks){result.set(part,offset);offset+=part.byteLength;}return result;
 }finally{reader.releaseLock();}
}
function projected(m,outcome){
 if(!['committed','replayed'].includes(outcome.kind))return outcome;
 const r=outcome.receipt,v=outcome.value,source=m.operationKind===STAGE_COLLECTION_RECORD,formats=source?['collection-page-v1','collection-list-v1','collection-source-v1']:['collection-cut-page-v1','collection-cut-root-v1'];
 if(r.operationKind!==m.operationKind||r.businessIdentity!==m.id||r.resultRef!==m.id||v?.id!==m.id||v.size!==m.size||!formats.includes(v.format))bad(409,'upload_identity_conflict','The accepted upload does not match this metadata.');
 if(source?v.visibility!=='private-staging':v.source!=='local-fixture'||v.executable!==false)bad(409,'upload_identity_conflict','The accepted upload does not match this metadata.');
 return {kind:outcome.kind,receipt:r,value:source?{id:v.id,size:v.size,format:v.format,visibility:'private-staging'}:{id:v.id,size:v.size,format:v.format,source:'local-fixture',executable:false},projection:'safe-upload-summary-v1'};
}
/** Loopback-only binary record intake. No temporary storage, generic file API,
 * wallet authority, remote upload, or active collection publication is implied. */
export function createOperatorUploadTransport(db,{sessions,clock=Date.now,crypto=createNodeCrypto(),ids={next:randomUUID}}){
 return async request=>{
  const {hostname,origin,pathname}=new URL(request.url);
  if(!['127.0.0.1','localhost'].includes(hostname))return failure(403,'local_only','Use the local operator origin.');
  if(!['/ops/uploads/preview','/ops/uploads/execute','/ops/uploads/receipt'].includes(pathname))return failure(404,'not_found','Unknown operator upload.');
  if(request.method!=='POST')return failure(405,'method_not_allowed','Use POST.',{allow:'POST'});
  if(request.headers.get('origin')!==origin)return failure(403,'invalid_origin','Use the operator origin.');
  try{
   const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];sessions.authenticate(token);
   if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/octet-stream')bad(415,'media_type','Use application/octet-stream.');
   const m=metadata(request),authorization=sessions.authorize(token,m.operationKind),source=m.operationKind===STAGE_COLLECTION_RECORD,receiptOnly=pathname.endsWith('/receipt'),previewOnly=pathname.endsWith('/preview');
   const body=await bytes(request,receiptOnly?0:m.size),principal=authorization.principal,driver=createNodeAtomicDriver(db,{transactionGuard:authorization.guard}),ports={crypto,ids,clock:{nowMs:clock}};
   const command=source?await prepareCollectionIntakeCommand(m.operationKind,{principal,requestKey:m.requestKey,input:{id:m.id},expectedRevisions:m.expectedRevisions,nowMs:clock()},crypto):await buildCollectionCutCommand(m.operationKind,principal,{requestKey:m.requestKey,id:m.id,expectedRevisions:m.expectedRevisions},crypto);
   if(receiptOnly){
    const result=await createAtomicReceipts(driver,ports).replay(command);authorization.guard();
    if(!result||result.kind==='pending')return failure(404,'receipt_not_found','No accepted receipt matches this upload. No change was executed.');
    return json(projected(m,result),result.kind==='conflict'?409:200);
   }
   const record={id:m.id,size:m.size,bytes:body},verified=await(source?prepareCollectionRecord(record,crypto):prepareCollectionCutRecord(record,crypto));
   const confirmationDigest=await crypto.sha256(utf8(canonicalJson(['10x-local-operator-upload-confirmation-v1',principal.id,m])));authorization.guard();
   const sources=createCollectionSourceIntake({...ports,repository:createCollectionSourceRepository(driver,ports)}),cuts=createCollectionCutRepository(driver,ports),input={requestKey:m.requestKey,expectedRevisions:m.expectedRevisions,record};
   if(previewOnly){
    const [versions,scopes]=await driver.batch([{sql:'SELECT name,revision FROM app_revisions ORDER BY name',values:[]},{sql:'SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope=?',values:[principal.id,source?'collection-import':'collection-evidence']}]);
    if(scopes.rows[0]?.enabled!==1)return failure(403,'operator_scope_required','Operator scope is unavailable.');
    const current=Object.fromEntries(versions.rows.map(r=>[r.name,String(r.revision)]));if(Object.keys(current).length!==3||Object.entries(m.expectedRevisions).some(([k,v])=>current[k]!==v))return failure(409,'revision_conflict','Refresh the current configuration before preview.');
    const result=await(source?sources.previewRecord(principal,input):cuts.previewCommand(command,record));authorization.guard();
    if(result.kind!=='preview')return json(projected(m,result),result.kind==='conflict'?409:result.kind==='pending'?202:200);
    return json({operationKind:m.operationKind,requestKey:m.requestKey,requestDigest:command.requestDigest,confirmationDigest,expectedRevisions:m.expectedRevisions,financialExecution:false,summary:{id:m.id,size:m.size,format:verified.format,privateStaging:true,financialExecution:false}});
   }
   if(request.headers.get('x-operator-preview')!==confirmationDigest)return failure(409,'preview_required','Confirm the exact upload preview.');
   const result=await(source?sources.stageRecord(principal,input):cuts.stageRecord(command,record));authorization.guard();
   return json(projected(m,result),result.kind==='conflict'?409:result.kind==='pending'?202:200);
  }catch(error){
   if(error instanceof EarnError||error instanceof OperatorSessionError)return failure(error.status,error.code,error.message);
   if(error instanceof TypeError||error instanceof RangeError||error instanceof SyntaxError)return failure(400,'invalid_upload','Invalid private record upload.');
   return failure(500,'internal_error','Operator upload failed.');
  }
 };
}
