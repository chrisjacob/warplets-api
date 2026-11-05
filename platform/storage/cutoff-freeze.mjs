import {createAtomicReceipts} from './atomic-receipts.mjs';
import {sql,revisions,matchesExpectedRevisions} from './atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {name,nat} from '../earn/validation.mjs';
import {DAY_MS} from '../domain/earn/index.mjs';
const kind='earn.freeze-epoch.v1',clone=value=>JSON.parse(canonicalJson(value));
const requestBytes=c=>utf8(canonicalJson([kind,c.principal,c.epoch,c.expectedRevisions]));
export async function createFreezeCommand({principal,epoch,nowMs,expectedRevisions={}},crypto){
 const c=clone({operationKind:kind,principal,epoch,nowMs,expectedRevisions,requestKey:'epoch:'+epoch,businessIdentity:String(epoch)});
 c.requestDigest=await crypto.sha256(requestBytes(c));return c;
}
export function createCutoffFreezeRepository(driver,{crypto,ids,telemetry}){
 const {read,replay,execute}=createAtomicReceipts(driver,{crypto,ids,telemetry});
 const query=epoch=>sql('SELECT id,wallet,token_id AS tokenId,epoch,url,submitted_ms AS submittedMs,entry_read_id AS entryReadId,request_key AS requestKey FROM earn_submissions WHERE epoch=? ORDER BY id LIMIT 101',epoch);
 return Object.freeze({
  async readFreeze(epoch){nat(epoch,'epoch');const [rows]=await read([sql('SELECT * FROM app_epoch_freezes WHERE epoch=?',epoch)]);return rows[0]??null;},
  async freezeEpoch(value){
   const c=clone(value);nat(c.epoch,'epoch');nat(c.nowMs,'now');name(c.principal?.id,'operator');
   if(c.operationKind!==kind||c.principal.kind!=='operator'||c.businessIdentity!==String(c.epoch)||c.requestKey!=='epoch:'+c.epoch||c.requestDigest!==await crypto.sha256(requestBytes(c)))throw new TypeError('Invalid epoch freeze command.');
   const prior=await replay(c);if(prior)return prior;
   const cutoff=(c.epoch+1)*DAY_MS-1;if(c.nowMs<=cutoff)return {kind:'pending',reason:'board-open',dependencyIds:[]};
   const [versions,posts,frozen]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),query(c.epoch),sql('SELECT 1 FROM app_epoch_freezes WHERE epoch=?',c.epoch)]);
   if(frozen.length)return {kind:'conflict',code:'epoch-already-frozen'};
   if(posts.length>100)return {kind:'pending',reason:'admission-bound',dependencyIds:[]};
   const version=revisions(versions);if(!matchesExpectedRevisions(c.expectedRevisions,version))return {kind:'conflict',code:'revision_conflict'};
   // Keep full URLs out of the duplicated SQL batch payload. Each immutable row
   // has its own digest; the inventory digest binds their canonical order.
   const inventory=await Promise.all(posts.map(async post=>({id:post.id,digest:await crypto.sha256(utf8(canonicalJson(post)))})));
   const inventoryJson=canonicalJson(inventory),admissionDigest=await crypto.sha256(utf8(inventoryJson)),input={epoch:c.epoch,admissionDigest,admissionCount:posts.length,inventoryJson};
   const nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec') * 1000 AS INTEGER)";
   return execute(c,{businessKey:c.businessIdentity,input,result:{epoch:c.epoch,admissionDigest,admissionCount:posts.length},resultRef:admissionDigest,version,
    authoritySql:`EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='earn-snapshot' AND enabled=1) AND ${nowSql}>?`,authorityValues:[c.principal.id,cutoff],
    child:(gate,v)=>sql(`INSERT INTO app_epoch_freezes SELECT ?,?,?,json_extract(input_json,'$.inventoryJson'),?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,
     c.epoch,admissionDigest,posts.length,c.nowMs,...v,...v)});
  },
 });
}
