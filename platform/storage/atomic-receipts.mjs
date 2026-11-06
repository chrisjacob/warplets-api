import { canonicalJson,utf8 } from '../security/canonical.mjs';
import { sql,measureBatch } from './atomic-driver.mjs';
const pending=reason=>({kind:'pending',reason,dependencyIds:[]});
const conflict=code=>({kind:'conflict',code});
const principalKey=p=>p.kind+':'+(p.kind==='wallet'?p.wallet:p.id);
const selectedReceipt=(command)=>sql('SELECT * FROM app_command_receipts WHERE principal_key=? AND operation_kind=? AND request_key=?',
  principalKey(command.principal),command.operationKind,command.requestKey);
function recovered(row,command) {
  if(!row)return null;
  if(row.request_digest!==command.requestDigest)return conflict('idempotency_conflict');
  if(row.state!=='committed')return pending('command-incomplete');
  return {kind:'replayed',receipt:{operationId:row.operation_id,principal:command.principal,operationKind:row.operation_kind,
    businessIdentity:row.business_key,requestKey:row.request_key,requestDigest:row.request_digest,
    expectedRevisions:JSON.parse(row.expected_revisions),outputDigest:row.output_digest,status:'committed',resultRef:row.result_ref},value:JSON.parse(row.result_json)};
}
// Storage-internal primitive; never expose arbitrary statements to a handler.
export function createAtomicReceipts(driver,{crypto,ids,telemetry={record(){}}}) {
  const hash=value=>crypto.sha256(utf8(canonicalJson(value)));
  async function read(statements) {return (await driver.batch(statements)).map(r=>r.rows);}
  async function replay(command) {return recovered((await read([selectedReceipt(command)]))[0][0],command);}
  async function execute(command,{businessKey,input,result,resultRef,version,child,authoritySql='1',authorityValues=[]}) {
    command=JSON.parse(canonicalJson(command));input=JSON.parse(canonicalJson(input));
    result=JSON.parse(canonicalJson(result));version=JSON.parse(canonicalJson(version));
    const authoritySnapshot=typeof authorityValues==='function'?authorityValues:[...authorityValues];
    const operationId=ids.next(),nonce=ids.next(),outputDigest=await hash(result);
    authorityValues=typeof authoritySnapshot==='function'?authoritySnapshot():authoritySnapshot;
    const identity=[operationId,principalKey(command.principal),command.operationKind,businessKey,command.requestKey,command.requestDigest,
      canonicalJson(version),nonce,canonicalJson(input),canonicalJson(result),outputDigest,resultRef,command.nowMs];
    const claim=sql(`INSERT INTO app_command_receipts
      (operation_id,principal_key,operation_kind,business_key,request_key,request_digest,expected_revisions,claim_nonce,state,input_json,result_json,output_digest,result_ref,created_ms)
      SELECT ?,?,?,?,?,?,?,?,'staging',?,?,?,?,?
      WHERE (SELECT revision FROM app_revisions WHERE name='earn')=?
       AND (SELECT revision FROM app_revisions WHERE name='source')=?
       AND (SELECT revision FROM app_revisions WHERE name='control')=?
       AND NOT EXISTS(SELECT 1 FROM app_command_receipts WHERE (principal_key=? AND operation_kind=? AND request_key=?) OR (operation_kind=? AND business_key=?))
       AND (${authoritySql})`,...identity,Number(version.earn),Number(version.source),Number(version.control),
       principalKey(command.principal),command.operationKind,command.requestKey,command.operationKind,businessKey,...authorityValues);
    const gate="EXISTS(SELECT 1 FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging')";
    const effects=child(gate,[operationId,nonce]);
    const statements=[claim,...(Array.isArray(effects)?effects:[effects]),sql("UPDATE app_command_receipts SET state='committed' WHERE operation_id=? AND claim_nonce=? AND state='staging'",operationId,nonce)];
    telemetry.record('atomic-batch',measureBatch(statements));
    let results;
    try {results=await driver.batch(statements);}
    catch(error) {
      // A response can be lost after commit; resolve the stable identity before
      // surfacing the transport error. Never invent success on missing receipt.
      const resolved=await replay(command);
      if(resolved)return resolved;
      throw error;
    }
    const row=(await read([selectedReceipt(command)]))[0][0],outcome=recovered(row,command);
    // D1 can include trigger writes in meta.changes. The durable attempt nonce,
    // plus a positive claim write distinguishes this attempt from a no-op retry.
      // A zero claim remains a replay even if an injected ID factory repeats IDs.
    if(outcome?.kind==='replayed')return {...outcome,kind:results[0].changes>0&&row.operation_id===operationId&&row.claim_nonce===nonce?'committed':'replayed'};
    if(outcome)return outcome;
    return conflict('revision_conflict');
  }
  return Object.freeze({read,replay,execute});
}
