import {CONFIGURE_ACTION,buildActionPolicyCommand} from './action-policy-service.mjs';
import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {prepareConfigAudit,configAuditStatement} from '../storage/atomic-audit.mjs';
import {sql,revisions,matchesExpectedRevisions} from '../storage/atomic-driver.mjs';
import {canonicalJson} from '../security/canonical.mjs';
const conflict=code=>({kind:'conflict',code}),pending=reason=>({kind:'pending',reason,dependencyIds:[]});
const DAY=86400000,MAX_TIME=8640000000000000;
const grant="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='earn-action-policy' AND enabled=1)";
/** Append-only future local policy. An accepted receipt is resolved before
 * current scheduling/grant checks; catalog changes confer no issuer authority. */
export function createActionPolicyRepository(driver,ports){
 const {crypto,clock}=ports,{read,replay,execute}=createAtomicReceipts(driver,ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 async function configure(value,previewOnly=false){
  const c=structuredClone(value),expected=await buildActionPolicyCommand({principal:c.principal,requestKey:c.requestKey,input:c.input,nowMs:c.nowMs,expectedRevisions:c.expectedRevisions},crypto);
  if(c.operationKind!==CONFIGURE_ACTION||canonicalJson(c)!==canonicalJson(expected))throw new TypeError('Invalid action-policy command.');
  const prior=await replay(c);if(prior)return prior;
  const now=clock.nowMs();if(!Number.isSafeInteger(now)||now<0||now>MAX_TIME-30000)return pending('action-policy-clock-unavailable');
  const i=c.input,[rs,grants,catalog,policies,closed,heads]=await read([
   sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),
   sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='earn-action-policy'",c.principal.id),
   sql('SELECT id,CASE WHEN length(CAST(label AS BLOB))<=1024 THEN label ELSE NULL END label,CASE WHEN length(CAST(verifier AS BLOB))<=1024 THEN verifier ELSE NULL END verifier FROM earn_action_catalog WHERE id=?',i.actionId),
   sql('SELECT enabled,recorded_ms FROM earn_action_changes WHERE action_id=? AND effective_epoch=?',i.actionId,i.effectiveEpoch),
   sql('SELECT 1 FROM earn_boards WHERE epoch>=? LIMIT 1',i.effectiveEpoch),
   sql('SELECT seq,event_hash FROM ops_config_audit ORDER BY seq DESC LIMIT 1'),
  ]);
  if(rs.length!==3||new Set(rs.map(r=>r.name)).size!==3||rs.some(r=>!['earn','source','control'].includes(r.name)||typeof r.revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(r.revision)||!Number.isSafeInteger(Number(r.revision))))return pending('action-policy-revisions-unavailable');
  const version=revisions(rs);if(!matchesExpectedRevisions(c.expectedRevisions,version))return conflict('revision_conflict');
  if(grants[0]?.enabled!==1)return conflict('operator_scope_required');
  if(i.effectiveEpoch<=Math.floor(now/DAY))return conflict('action_not_future');
  const action=catalog[0],old=policies[0];if(action&&(action.label!==i.label||action.verifier!==i.verifier))return conflict('action_conflict');
  if(old)return conflict(old.enabled===Number(i.enabled)?'action_policy_already_exists':'policy_conflict');
  if(closed.length)return conflict('board_closed');
  const head=heads[0];if(head&&(!Number.isSafeInteger(head.seq)||head.seq<1||head.seq>=Number.MAX_SAFE_INTEGER||typeof head.event_hash!=='string'||!/^[a-f0-9]{64}$/.test(head.event_hash)))return pending('action-policy-audit-unavailable');
  const result={actionId:i.actionId,effectiveEpoch:i.effectiveEpoch,enabled:i.enabled,source:'local-fixture',executable:false};
  if(previewOnly)return {kind:'preview',value:{...result,label:i.label,verifier:i.verifier,expectedRevisions:version,financialExecution:false}};
  const event={category:'action-policy',entity:i.actionId,changeKey:String(i.effectiveEpoch),atMs:now,actor:c.principal.id,evidenceRef:i.evidenceRef,payload:{label:i.label,verifier:i.verifier,enabled:i.enabled,effectiveEpoch:i.effectiveEpoch}},audit=await prepareConfigAudit(head,event,crypto);
  const catalogFence=action?'EXISTS(SELECT 1 FROM earn_action_catalog WHERE id=? AND label=? AND verifier=?)':'NOT EXISTS(SELECT 1 FROM earn_action_catalog WHERE id=?)';
  return execute({...c,nowMs:now},{businessKey:c.businessIdentity,input:{...i,audit},result,resultRef:c.businessIdentity,version,
   authoritySql:`${grant} AND ${nowSql}>=? AND ${nowSql}<=? AND ?>CAST((${nowSql})/86400000 AS INTEGER) AND NOT EXISTS(SELECT 1 FROM earn_boards WHERE epoch>=?) AND ${catalogFence} AND NOT EXISTS(SELECT 1 FROM earn_action_changes WHERE action_id=? AND effective_epoch=?)`,
   authorityValues:[c.principal.id,now,now+30000,i.effectiveEpoch,i.effectiveEpoch,...(action?[i.actionId,i.label,i.verifier]:[i.actionId]),i.actionId,i.effectiveEpoch],
   child:(gate,v)=>[
    ...(!action?[sql(`INSERT INTO earn_action_catalog(id,label,verifier) SELECT ?,?,? WHERE ${gate}`,i.actionId,i.label,i.verifier,...v)]:[]),
    sql(`INSERT INTO earn_action_changes(action_id,effective_epoch,enabled,recorded_ms) SELECT ?,?,?,? WHERE ${gate}`,i.actionId,i.effectiveEpoch,Number(i.enabled),now,...v),
    configAuditStatement(audit,event,gate,v),
   ]});
 }
 return Object.freeze({configureAction:value=>configure(value),previewAction:value=>configure(value,true)});
}
