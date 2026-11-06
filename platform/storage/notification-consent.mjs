import {SET_NOTIFICATION_CONSENT,NOTICE_TERMS,normalizeNotificationConsentInput,notificationPrincipal,buildNotificationConsentCommand} from '../notifications/consent.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {sql,revisions} from './atomic-driver.mjs';
import {createAtomicReceipts} from './atomic-receipts.mjs';
const pending=reason=>({kind:'pending',reason,dependencyIds:[]}),conflict=code=>({kind:'conflict',code});
const writable="EXISTS(SELECT 1 FROM app_recovery_state WHERE id=1 AND mode IN ('live','private') AND status IN ('live','ready') AND write_nonce IS NULL AND generation=?)";
function preference(row){
 if(!row)return {channel:'local-inbox',revision:0,enabled:false,topics:[],terms:NOTICE_TERMS,changedAtMs:null};
 if(!Number.isSafeInteger(row.revision)||row.revision<1||![0,1].includes(row.enabled)||!Number.isSafeInteger(row.changed_ms)||row.changed_ms<0||row.changed_ms>8640000000000000)throw new TypeError('Invalid retained preference.');
 const topics=JSON.parse(row.topics),i=normalizeNotificationConsentInput({channel:row.channel,enabled:!!row.enabled,topics,terms:row.terms,expectedRevision:row.revision-1});
 if(JSON.stringify(i.topics)!==row.topics)throw new TypeError('Invalid retained topic order.');
 return {channel:i.channel,revision:row.revision,enabled:i.enabled,topics:i.topics,terms:i.terms,changedAtMs:row.changed_ms};
}
const prefSql=wallet=>sql("SELECT channel,revision,enabled,CASE WHEN length(CAST(topics AS BLOB))<=64 THEN topics ELSE NULL END topics,CASE WHEN length(CAST(terms AS BLOB))<=64 THEN terms ELSE NULL END terms,changed_ms FROM notice_preferences WHERE wallet=? AND channel='local-inbox'",wallet);
/** Accepted identity is stable; current preference is intentionally reread on
 * replay so a historical enable can never imply renewed consent. */
export function createNotificationConsentRepository(driver,ports){
 const {crypto,clock}=ports,{read,execute}=createAtomicReceipts(driver,ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 async function readPreferences(principal){const p=notificationPrincipal(principal),[rows]=await read([prefSql(p.wallet)]);return preference(rows[0]);}
 async function resolve(c){
  const [keys,prefs,receipts]=await read([
   sql('SELECT CASE WHEN length(request_hash)=64 THEN request_hash ELSE NULL END request_hash,revision,changed_ms FROM notice_consent_requests WHERE wallet=? AND channel=? AND request_key=?',c.principal.wallet,c.input.channel,c.requestKey),prefSql(c.principal.wallet),
   sql('SELECT state,CASE WHEN length(request_digest)=64 THEN request_digest ELSE NULL END request_digest,CASE WHEN length(CAST(business_key AS BLOB))<=256 THEN business_key ELSE NULL END business_key,CASE WHEN length(CAST(result_ref AS BLOB))<=256 THEN result_ref ELSE NULL END result_ref,CASE WHEN length(CAST(result_json AS BLOB))<=64 THEN result_json ELSE NULL END result_json,created_ms FROM app_command_receipts WHERE principal_key=? AND operation_kind=? AND request_key=?','wallet:'+c.principal.wallet,SET_NOTIFICATION_CONSENT,c.requestKey)]);
  const key=keys[0],r=receipts[0];if(!key&&!r)return null;
  if(key&&key.request_hash!==c.requestDigest||r&&r.request_digest!==c.requestDigest)return conflict('key_conflict');
  if(!key||r&&r.state!=='committed')return pending('consent-receipt-incomplete');
  if(key.revision!==c.input.expectedRevision+1||!Number.isSafeInteger(key.changed_ms)||key.changed_ms<0)return pending('consent-receipt-invalid');
  if(r&&(r.business_key!==c.businessIdentity||r.result_ref!==c.businessIdentity||r.result_json!==canonicalJson({appliedRevision:key.revision})||r.created_ms!==key.changed_ms))return pending('consent-receipt-invalid');
  let current;try{current=preference(prefs[0]);}catch{return pending('consent-preference-invalid');}
  if(current.revision<key.revision)return pending('consent-preference-invalid');
  return {appliedRevision:key.revision,preference:current,replay:true};
 }
 async function setConsent(value){
  const c=structuredClone(value),expected=await buildNotificationConsentCommand({principal:c.principal,requestKey:c.requestKey,input:c.input,nowMs:c.nowMs},crypto);
  if(canonicalJson(c)!==canonicalJson(expected))throw new TypeError('Invalid consent command.');
  const prior=await resolve(c);if(prior)return prior;
  const now=clock.nowMs();if(!Number.isSafeInteger(now)||now<0||now>8640000000000000-30000)return pending('consent-clock-unavailable');
  const [rs,prefs,recovery]=await read([sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),prefSql(c.principal.wallet),sql('SELECT mode,status,generation,write_nonce FROM app_recovery_state WHERE id=1')]);
  if(rs.length!==3||new Set(rs.map(r=>r.name)).size!==3||rs.some(r=>!['earn','source','control'].includes(r.name)||typeof r.revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(r.revision)||!Number.isSafeInteger(Number(r.revision))))return pending('consent-revisions-unavailable');
  const state=recovery[0];if(!state||!['live','private'].includes(state.mode)||!['live','ready'].includes(state.status)||state.write_nonce!==null)return pending('read-only-recovery');
  let before;try{before=preference(prefs[0]);}catch{return pending('consent-preference-invalid');}
  const i=c.input,wallet=c.principal.wallet;
  if(before.revision!==i.expectedRevision||now<(before.changedAtMs??0))return conflict('consent_conflict');
  const version=revisions(rs),revision=i.expectedRevision+1,result={appliedRevision:revision},previous=prefs[0];
  const bound=previous?'EXISTS(SELECT 1 FROM notice_preferences WHERE wallet=? AND channel=? AND revision=? AND enabled=? AND topics=? AND terms=? AND changed_ms=?)':'NOT EXISTS(SELECT 1 FROM notice_preferences WHERE wallet=? AND channel=?)';
  const outcome=await execute({...c,nowMs:now,expectedRevisions:version},{businessKey:c.businessIdentity,input:i,result,resultRef:c.businessIdentity,version,
   authoritySql:`${writable} AND ${nowSql}>=? AND ${nowSql}<=? AND ${bound} AND NOT EXISTS(SELECT 1 FROM notice_consent_requests WHERE wallet=? AND channel=? AND request_key=?)`,
   authorityValues:[state.generation,now,now+30000,wallet,i.channel,...(previous?[before.revision,Number(before.enabled),previous.topics,before.terms,before.changedAtMs]:[]),wallet,i.channel,c.requestKey],
   child:(gate,v)=>[
    sql(`INSERT INTO notice_preferences(wallet,channel,revision,enabled,topics,terms,changed_ms) SELECT ?,?,?,?,?,?,? WHERE ${gate} ON CONFLICT(wallet,channel) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,topics=excluded.topics,terms=excluded.terms,changed_ms=excluded.changed_ms`,wallet,i.channel,revision,Number(i.enabled),JSON.stringify(i.topics),i.terms,now,...v),
    sql(`INSERT INTO notice_consent_requests(wallet,channel,request_key,request_hash,revision,changed_ms) SELECT ?,?,?,?,?,? WHERE ${gate}`,wallet,i.channel,c.requestKey,c.requestDigest,revision,now,...v),
    sql(`UPDATE notice_outbox SET state='cancelled',lease=NULL,lease_until_ms=NULL WHERE wallet=? AND channel=? AND state IN ('queued','retry','leased','unknown') AND ${gate}`,wallet,i.channel,...v),
    ...(!i.enabled?[sql(`DELETE FROM notice_inbox WHERE wallet=? AND ${gate}`,wallet,...v)]:[]),
   ]});
  const resolved=await resolve(c);if(resolved&&'appliedRevision' in resolved)return {...resolved,replay:outcome.kind!=='committed'};
  return resolved??outcome;
 }
 return Object.freeze({readPreferences,setConsent});
}
