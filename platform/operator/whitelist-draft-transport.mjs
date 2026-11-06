import {dryRunWhitelist} from '../collect/whitelist-import.mjs';
import {createCollectionStateCodec} from '../collect/state-codec.mjs';
import {createNodeAtomicDriver} from '../storage/node/atomic-driver.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {json,failure} from '../server/api.mjs';
import {EarnError} from '../earn/validation.mjs';
import {OperatorSessionError} from './session.mjs';
const KIND='collection.validate-whitelist.v1',LIMIT=524288;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const invalid=()=>{throw new EarnError(400,'invalid_draft','Supply exact bounded whitelist draft fields.');};
async function readDraft(request){
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new EarnError(415,'media_type','Use application/json.');
 const reader=request.body?.getReader();if(!reader)invalid();let total=0;const parts=[];
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array))invalid();total+=value.byteLength;if(total>LIMIT){await reader.cancel();throw new EarnError(413,'body_too_large','Whitelist draft exceeds 512 KiB.');}parts.push(value.slice());}
  const bytes=new Uint8Array(total);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.byteLength;}
  let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{invalid();}
  if(!exact(body,['source','inventoryId','stageId','entries'])||typeof body.source!=='string'||!body.source.trim()||body.source.length>256||!id(body.inventoryId)||!id(body.stageId)||!Array.isArray(body.entries)||body.entries.length>10000)invalid();
  return body;
 }finally{reader.releaseLock();}
}
/** Private, read-only draft validation. Digests identify a candidate; they do
 * not stage records, approve economics, authorize publication or expose lists. */
export function createWhitelistDraftTransport(db,{sessions,clock=Date.now,crypto=createNodeCrypto()}){
 return async request=>{
  const {hostname,origin,pathname}=new URL(request.url);
  if(!['localhost','127.0.0.1'].includes(hostname))return failure(403,'local_only','Use the local operator origin.');
  if(pathname!=='/ops/drafts/whitelist')return failure(404,'not_found','Unknown operator draft.');
  if(request.method!=='POST')return failure(405,'method_not_allowed','Use POST.',{allow:'POST'});
  if(request.headers.get('origin')!==origin)return failure(403,'invalid_origin','Use the operator origin.');
  try{
   const raw=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1],authorization=sessions.authorize(raw,KIND),at=clock();
   if(!Number.isSafeInteger(at)||at<0)throw new EarnError(400,'invalid_clock','Local validation clock is unavailable.');
   const body=await readDraft(request),driver=createNodeAtomicDriver(db,{transactionGuard:authorization.guard});
   const context=async()=>{
    const [versions,grants]=await driver.batch([{sql:'SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name',values:[]},{sql:"SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='collection-import'",values:[authorization.principal.id]}]);
    if(versions.rows.length!==3||new Set(versions.rows.map(r=>r.name)).size!==3||versions.rows.some(r=>!['earn','source','control'].includes(r.name)||typeof r.revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(r.revision)||!Number.isSafeInteger(Number(r.revision))))throw new EarnError(409,'revision_conflict','Current configuration is unavailable.');
    return {revisions:Object.fromEntries(versions.rows.map(r=>[r.name,r.revision])),enabled:grants.rows[0]?.enabled===1};
   };
   const before=await context();if(!before.enabled)return failure(403,'operator_scope_required','Operator scope is unavailable.');
   const validated=dryRunWhitelist({source:body.source,entries:body.entries}),eligibilityListId=validated.publishable?(await createCollectionStateCodec({crypto}).encodeWalletList(validated.wallets)).manifest.id:null;
   const after=await context();authorization.guard();if(!after.enabled||Object.keys(before.revisions).some(k=>before.revisions[k]!==after.revisions[k]))return failure(409,'revision_conflict','Configuration changed during validation. Validate the draft again.');
   return json({operationKind:KIND,source:validated.source,inventoryId:body.inventoryId,stageId:body.stageId,inputCount:validated.inputCount,acceptedCount:validated.acceptedCount,duplicateCount:validated.duplicateCount,errorCount:validated.errorCount,errors:validated.errors.slice(0,100).map(e=>({index:e.index,reason:e.reason})),errorsTruncated:validated.errorCount>100,digest:validated.digest,eligibilityListId,publishable:validated.publishable,expectedRevisions:before.revisions,financialExecution:false,staged:false,isAuthorization:false});
  }catch(error){
   if(error instanceof EarnError||error instanceof OperatorSessionError)return failure(error.status,error.code,error.message);
   if(error instanceof TypeError||error instanceof RangeError||error instanceof SyntaxError)return failure(400,'invalid_draft','Invalid whitelist draft.');
   return failure(500,'internal_error','Whitelist draft validation failed.');
  }
 };
}
