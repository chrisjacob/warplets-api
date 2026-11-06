import {ENQUEUE_NOTICE,DELIVER_NOTICE,buildEnqueueNoticeCommand,buildDeliverNoticeCommand,noticeWorkerPrincipal,prepareNoticeSource,noticeSourceKey} from '../notifications/delivery-plan.mjs';
import {notificationPrincipal,NOTICE_TERMS} from '../notifications/consent.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {sql,revisions} from './atomic-driver.mjs';
import {createAtomicReceipts} from './atomic-receipts.mjs';
import {historicalUsageSql,historicalSpendSql} from './atomic-operations.mjs';
import {pressureFromRows,decisionFromRows} from '../operations/portable-controls.mjs';
import {retentionPayload,retentionBusinessKey,retentionSourceKey} from '../notifications/retention-plan.mjs';
import {NOTICE_DELIVERY_JOB,deliveryJobBusinessKey,deliveryJobSourceKey} from '../notifications/delivery-job-plan.mjs';
const DAY=86400000,MAX=8640000000000000;
const conflict=code=>({kind:'conflict',code}),pending=reason=>({kind:'pending',reason,dependencyIds:[]});
const states=['queued','leased','retry','delivered','unknown','cancelled'];
const grant="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='notification-work' AND enabled=1)";
const writable="EXISTS(SELECT 1 FROM app_recovery_state WHERE id=1 AND mode IN ('live','private') AND status IN ('live','ready') AND write_nonce IS NULL AND generation=?)";
function sourceSql(i){
 if(i.topic==='launch')return sql('SELECT CASE WHEN length(CAST(body AS BLOB))<=65536 THEN body ELSE NULL END body FROM market_fixtures WHERE id=?',i.subject);
 if(i.topic==='voting')return sql('SELECT b.id,b.opens_ms AS opensMs,b.closes_ms AS closesMs FROM genesis_ballots b JOIN genesis_voters v ON v.ballot_id=b.id WHERE b.id=? AND v.wallet=?',i.subject,i.wallet);
 return sql('SELECT CASE WHEN length(a.amount)<=80 THEN a.amount ELSE NULL END amount,c.epoch,c.vests_from_ms AS vestsFromMs,c.vests_through_ms AS vestsThroughMs FROM earn_awards a JOIN earn_allocations c ON a.token_id=c.token_id AND a.day=c.day WHERE a.wallet=? AND a.token_id=? AND a.day=?',i.wallet,i.subject.tokenId,i.subject.day);
}
function sourceFence(i,f){
 if(i.topic==='launch')return {text:'EXISTS(SELECT 1 FROM market_fixtures WHERE id=? AND body=?)',values:[i.subject,f.body]};
 if(i.topic==='voting')return {text:'EXISTS(SELECT 1 FROM genesis_ballots b JOIN genesis_voters v ON v.ballot_id=b.id WHERE b.id=? AND v.wallet=? AND b.opens_ms=? AND b.closes_ms=?)',values:[i.subject,i.wallet,f.opensMs,f.closesMs]};
 return {text:'EXISTS(SELECT 1 FROM earn_awards a JOIN earn_allocations c ON a.token_id=c.token_id AND a.day=c.day WHERE a.wallet=? AND a.token_id=? AND a.day=? AND a.amount=? AND c.epoch=? AND c.vests_from_ms=? AND c.vests_through_ms=?)',values:[i.wallet,i.subject.tokenId,i.subject.day,f.amount,f.epoch,f.vestsFromMs,f.vestsThroughMs]};
}
const eventSql=id=>sql('SELECT id,wallet,channel,topic,CASE WHEN length(CAST(subject AS BLOB))<=1024 THEN subject ELSE NULL END subject,state FROM notice_outbox WHERE id=?',id);
function existing(row,c){if(!row)return null;if(row.id!==c.businessIdentity||row.wallet!==c.input.wallet||row.channel!=='local-inbox'||row.topic!==c.input.topic||row.subject!==noticeSourceKey(c.input)||!states.includes(row.state))return pending('notice-history-invalid');return {state:row.state,id:row.id,replay:true};}
export function createNotificationDeliveryRepository(driver,ports){
 const {crypto,clock}=ports,{read,replay,execute}=createAtomicReceipts(driver,ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec')*1000 AS INTEGER)";
 async function enqueueNotice(value){
  const c=structuredClone(value),expected=await buildEnqueueNoticeCommand({principal:c.principal,requestKey:c.requestKey,input:c.input,nowMs:c.nowMs},crypto);
  if(canonicalJson(c)!==canonicalJson(expected))throw new TypeError('Invalid private enqueue command.');
  const accepted=await replay(c);if(accepted){if(accepted.kind!=='replayed')return accepted;const [rows]=await read([eventSql(c.businessIdentity)]);return existing(rows[0],c)??{state:'held',reason:'notice-history-unavailable',id:c.businessIdentity,replay:true};}
  const [old]=await read([eventSql(c.businessIdentity)]);if(old[0])return existing(old[0],c);
  const now=clock.nowMs();if(!Number.isSafeInteger(now)||now<0||now>MAX-30000)return pending('notice-clock-unavailable');const i=c.input,start=Math.floor(now/DAY)*DAY;
  const [rs,prefs,grants,source,counts,scopes,usage,spend,recovery]=await read([
   sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),
   sql("SELECT revision,enabled,CASE WHEN length(CAST(topics AS BLOB))<=64 THEN topics ELSE NULL END topics,terms,changed_ms FROM notice_preferences WHERE wallet=? AND channel='local-inbox'",i.wallet),
   sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='notification-work'",c.principal.id),sourceSql(i),
   sql('SELECT COUNT(*) n FROM notice_outbox WHERE wallet=? AND created_ms>=? AND created_ms<?',i.wallet,start,start+DAY),
   sql("SELECT paused,revision FROM ops_scope_log WHERE scope='optional-notifications' AND at_ms<=? ORDER BY at_ms DESC LIMIT 1",now),historicalUsageSql(now),historicalSpendSql(now),
   sql('SELECT mode,status,generation,write_nonce FROM app_recovery_state WHERE id=1')]);
  if(grants[0]?.enabled!==1)return conflict('operator_scope_required');
  const state=recovery[0];if(!state||!['live','private'].includes(state.mode)||!['live','ready'].includes(state.status)||state.write_nonce!==null)return pending('read-only-recovery');
  if(rs.length!==3||new Set(rs.map(r=>r.name)).size!==3||rs.some(r=>!['earn','source','control'].includes(r.name)||typeof r.revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(r.revision)||!Number.isSafeInteger(Number(r.revision))))return pending('notice-revisions-unavailable');
  const p=prefs[0];let topics;try{topics=JSON.parse(p?.topics??'[]');}catch{return pending('notice-consent-invalid');}
  if(!p||p.enabled!==1||!Array.isArray(topics)||!topics.includes(i.topic))return {state:'skipped',reason:'no-consent'};
  if(!Number.isSafeInteger(p.revision)||p.revision<1||p.terms!==NOTICE_TERMS||!Number.isSafeInteger(p.changed_ms)||p.changed_ms>now)return pending('notice-consent-invalid');
  const decision=decisionFromRows('optional-notifications',scopes[0],pressureFromRows(usage,spend,now));if(!decision.allowed)return {state:'held',reason:'delivery-paused'};
  let plan;try{plan=await prepareNoticeSource(i,source[0]??null,now,crypto);}catch{return pending('notice-source-invalid');}if(plan.kind!=='ready')return plan;
  if(counts[0]?.n>=3)return {state:'skipped',reason:'daily-cap'};
  const bound=sourceFence(i,source[0]),version=revisions(rs),result={state:'queued',id:c.businessIdentity},input={wallet:i.wallet,channel:'local-inbox',topic:i.topic,sourceKey:plan.sourceKey,sourceDigest:plan.sourceDigest,consentRevision:p.revision,expiresMs:plan.expiresMs,target:plan.target};
  const outcome=await execute({...c,nowMs:now,expectedRevisions:version},{businessKey:c.businessIdentity,input,result,resultRef:c.businessIdentity,version,
   authoritySql:`${grant} AND ${writable} AND ${nowSql}>=? AND ${nowSql}<=? AND ${nowSql}<? AND EXISTS(SELECT 1 FROM notice_preferences WHERE wallet=? AND channel='local-inbox' AND revision=? AND enabled=1 AND topics=? AND terms=? AND changed_ms<=${nowSql}) AND (SELECT COUNT(*) FROM notice_outbox WHERE wallet=? AND created_ms>=? AND created_ms<?)<3 AND ${bound.text} AND NOT EXISTS(SELECT 1 FROM notice_outbox WHERE id=?)`,
   authorityValues:[c.principal.id,state.generation,now,now+30000,plan.expiresMs,i.wallet,p.revision,p.topics,NOTICE_TERMS,i.wallet,start,start+DAY,...bound.values,c.businessIdentity],
   child:(gate,v)=>[sql(`INSERT INTO notice_outbox(id,wallet,channel,consent_revision,topic,subject,title,message,target,created_ms,expires_ms,state,attempts,ready_ms,lease,lease_until_ms) SELECT ?,?,?,?,?,?,?,?,?,?,?,'queued',0,?,NULL,NULL WHERE ${gate}`,c.businessIdentity,i.wallet,'local-inbox',p.revision,i.topic,plan.sourceKey,plan.title,plan.message,plan.target,now,plan.expiresMs,now,...v)]});
  if(!['committed','replayed'].includes(outcome.kind)){const [rows]=await read([eventSql(c.businessIdentity)]);return existing(rows[0],c)??outcome;}
  const [rows]=await read([eventSql(c.businessIdentity)]);const found=existing(rows[0],c);return found&&'state' in found?{...found,replay:outcome.kind!=='committed'}:found??{state:'held',reason:'notice-history-unavailable',id:c.businessIdentity,replay:true};
 }
 async function readInbox(principal,{cursor=null,limit=25}={}){
  const p=notificationPrincipal(principal),now=clock.nowMs();if(!Number.isSafeInteger(now)||now<0||now>MAX||!Number.isInteger(limit)||limit<1||limit>50)throw new TypeError('Invalid inbox query.');
  const match=cursor===null?null:typeof cursor==='string'&&/^(\d{1,16})\.([a-f0-9]{64})$/.exec(cursor);if(cursor!==null&&(!match||!Number.isSafeInteger(Number(match[1]))))throw new TypeError('Invalid inbox cursor.');
  const before=match?Number(match[1]):Number.MAX_SAFE_INTEGER,id=match?match[2]:'~';
  const [rows]=await read([sql(`SELECT o.id,o.topic,CASE WHEN length(CAST(o.title AS BLOB))<=256 THEN o.title ELSE NULL END title,CASE WHEN length(CAST(o.message AS BLOB))<=512 THEN o.message ELSE NULL END message,CASE WHEN length(CAST(o.target AS BLOB))<=4096 THEN o.target ELSE NULL END target,i.delivered_ms AS deliveredMs FROM notice_inbox i JOIN notice_outbox o ON o.id=i.id WHERE i.wallet=? AND o.wallet=i.wallet AND o.expires_ms>? AND (i.delivered_ms<? OR(i.delivered_ms=? AND i.id<?)) ORDER BY i.delivered_ms DESC,i.id DESC LIMIT ?`,p.wallet,now,before,before,id,limit+1)]);
  if(rows.some(r=>typeof r.id!=='string'||!/^[a-f0-9]{64}$/.test(r.id)||!['launch','voting','rewards'].includes(r.topic)||typeof r.title!=='string'||typeof r.message!=='string'||typeof r.target!=='string'||/[\\\x00-\x20]/.test(r.target)||!(r.topic==='launch'?/^\/markets\/[^/?#]+$/.test(r.target):r.topic==='voting'?r.target==='/collections/genesis':/^\/earn\/\d{4}-\d\d-\d\d$/.test(r.target))||!Number.isSafeInteger(r.deliveredMs)||r.deliveredMs<0))throw new TypeError('Invalid retained inbox.');
  const items=rows.slice(0,limit),last=items.at(-1);return {mode:'local-inbox',items,nextCursor:rows.length>limit?`${last.deliveredMs}.${last.id}`:null};
 }
 const recoverySql=sql('SELECT mode,status,generation,write_nonce FROM app_recovery_state WHERE id=1');
 const isWritable=s=>s&&['live','private'].includes(s.mode)&&['live','ready'].includes(s.status)&&s.write_nonce===null;
 const currentConsent=`EXISTS(SELECT 1 FROM notice_preferences p WHERE p.wallet=notice_outbox.wallet AND p.channel=notice_outbox.channel AND p.enabled=1 AND p.revision=notice_outbox.consent_revision AND p.terms='${NOTICE_TERMS}' AND json_valid(p.topics) AND EXISTS(SELECT 1 FROM json_each(p.topics) WHERE value=notice_outbox.topic))`;
 const workerVersion=version=>({text:"(SELECT revision FROM app_revisions WHERE name='earn')=? AND (SELECT revision FROM app_revisions WHERE name='source')=? AND (SELECT revision FROM app_revisions WHERE name='control')=?",values:[Number(version.earn),Number(version.source),Number(version.control)]});
 function checkedVersion(rs){if(rs.length!==3||new Set(rs.map(r=>r.name)).size!==3||rs.some(r=>!['earn','source','control'].includes(r.name)||!Number.isSafeInteger(Number(r.revision))||Number(r.revision)<0))throw new TypeError('Invalid notice revisions.');return revisions(rs);}
 function at(){const now=clock.nowMs();if(!Number.isSafeInteger(now)||now<0||now>MAX-3600000)throw new TypeError('Invalid notice execution clock.');return now;}
 async function controls(principal){
  const now=at(),[rs,grants,scope,usage,spend,recovery]=await read([sql('SELECT name,CAST(revision AS TEXT) revision FROM app_revisions ORDER BY name'),sql("SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope='notification-work'",principal.id),sql("SELECT paused,revision FROM ops_scope_log WHERE scope='optional-notifications' AND at_ms<=? ORDER BY at_ms DESC LIMIT 1",now),historicalUsageSql(now),historicalSpendSql(now),recoverySql]);
  return {now,version:checkedVersion(rs),granted:grants[0]?.enabled===1,decision:decisionFromRows('optional-notifications',scope[0],pressureFromRows(usage,spend,now)),recovery:recovery[0]};
 }
 async function deliveryJobFence(p,id,lease){
  if(lease===undefined)return {text:'1=1',values:[]};
  if(!lease||Object.keys(lease).sort().join(',')!=='attempt,businessKey,expiresAtMs,jobId,payloadDigest,revision,token'||typeof lease.jobId!=='string'||!lease.jobId.length||lease.jobId.length>128||typeof lease.token!=='string'||!lease.token.length||lease.token.length>256||typeof lease.payloadDigest!=='string'||!/^[a-f0-9]{64}$/.test(lease.payloadDigest)||typeof lease.revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(lease.revision)||!Number.isSafeInteger(Number(lease.revision))||!Number.isInteger(lease.attempt)||lease.attempt<1||!Number.isSafeInteger(lease.expiresAtMs))throw new TypeError('Invalid notification job lease.');
  const payload={kind:NOTICE_DELIVERY_JOB,noticeId:id},body=canonicalJson(payload),digest=await crypto.sha256(utf8(body)),business=deliveryJobBusinessKey(payload);
  if(lease.businessKey!==business||lease.payloadDigest!==digest)return {text:'0',values:[]};
  return {text:`EXISTS(SELECT 1 FROM app_jobs WHERE id=? AND principal=? AND type='deliver-local-notice' AND business_key=? AND source_key=? AND payload_json=? AND payload_digest=? AND state='running' AND lease_token=? AND revision=? AND attempt=? AND lease_until_ms=? AND lease_until_ms>${nowSql}) AND EXISTS(SELECT 1 FROM app_execution_fences WHERE business_key=? AND holder_token=? AND revision=? AND payload_digest=? AND expires_ms=? AND expires_ms>${nowSql}) AND EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='jobs-runner' AND enabled=1)`,values:[lease.jobId,p.id,business,deliveryJobSourceKey(payload),body,digest,lease.token,Number(lease.revision),lease.attempt,lease.expiresAtMs,business,lease.token,Number(lease.revision),digest,lease.expiresAtMs,p.id]};
 }
 async function leaseDue(principal,options={},jobLease){
  const p=noticeWorkerPrincipal(principal),query=structuredClone(options),lease=jobLease===undefined?undefined:structuredClone(jobLease),limit=query?.limit??20,noticeId=query?.noticeId;
  if(!query||Object.keys(query).some(k=>!['limit','noticeId'].includes(k))||!Number.isInteger(limit)||limit<1||limit>20||noticeId!==undefined&&(typeof noticeId!=='string'||!/^[a-f0-9]{64}$/.test(noticeId))||lease!==undefined&&(noticeId===undefined||limit!==1))throw new TypeError('Lease 1-20 notices, or one bound job notice.');
  const bound=await deliveryJobFence(p,noticeId,lease),filter=noticeId===undefined?'1=1':'id=?',filterValues=noticeId===undefined?[]:[noticeId],ctx=await controls(p);if(!isWritable(ctx.recovery))return pending('read-only-recovery');
  // Receipt reconciliation is required maintenance, even while optional work is paused.
  await driver.batch([sql(`UPDATE notice_outbox SET state=CASE WHEN EXISTS(SELECT 1 FROM notice_inbox i WHERE i.id=notice_outbox.id AND i.wallet=notice_outbox.wallet) THEN 'delivered' ELSE 'unknown' END,lease=NULL,lease_until_ms=NULL WHERE state='leased' AND lease_until_ms<=? AND id IN(SELECT id FROM notice_outbox WHERE state='leased' AND lease_until_ms<=? AND ${filter} ORDER BY lease_until_ms,id LIMIT 20) AND ${writable} AND ${bound.text}`,ctx.now,ctx.now,...filterValues,ctx.recovery.generation,...bound.values)]);
  if(!ctx.granted)return conflict('operator_scope_required');if(!ctx.decision.allowed)return [];
  const [rows]=await read([sql(`SELECT id,attempts,expires_ms FROM notice_outbox WHERE state IN ('queued','retry') AND ready_ms<=? AND ${filter} ORDER BY ready_ms,id LIMIT ?`,ctx.now,...filterValues,limit)]);
  if(rows.some(r=>typeof r.id!=='string'||!/^[a-f0-9]{64}$/.test(r.id)||!Number.isInteger(r.attempts)||r.attempts<0||r.attempts>5||!Number.isSafeInteger(r.expires_ms)||r.expires_ms<0||r.expires_ms>MAX))return pending('notice-work-invalid');
  const fence=workerVersion(ctx.version),candidates=rows.map(r=>({...r,lease:ports.ids.next()}));
  if(candidates.some(r=>typeof r.lease!=='string'||r.lease.length<1||r.lease.length>256))throw new TypeError('Invalid notice lease token.');
  if(candidates.length)await driver.batch(candidates.map(r=>sql(`UPDATE notice_outbox SET state=CASE WHEN ${currentConsent} AND expires_ms>? AND attempts<5 THEN 'leased' ELSE 'cancelled' END,attempts=attempts+CASE WHEN ${currentConsent} AND expires_ms>? AND attempts<5 THEN 1 ELSE 0 END,lease=CASE WHEN ${currentConsent} AND expires_ms>? AND attempts<5 THEN ? ELSE NULL END,lease_until_ms=CASE WHEN ${currentConsent} AND expires_ms>? AND attempts<5 THEN ? ELSE NULL END WHERE id=? AND state IN ('queued','retry') AND ready_ms<=? AND attempts=? AND ${grant} AND ${writable} AND ${fence.text} AND ${nowSql}>=? AND ${nowSql}<? AND ${bound.text}`,ctx.now,ctx.now,ctx.now,r.lease,ctx.now,ctx.now+30000,r.id,ctx.now,r.attempts,p.id,ctx.recovery.generation,...fence.values,ctx.now,ctx.now+30000,...bound.values)));
  if(!candidates.length)return [];
  const [claimed]=await read([sql("SELECT id,lease FROM notice_outbox WHERE state='leased' AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?))",JSON.stringify(candidates.map(r=>({id:r.id}))))]);
  return claimed.filter(r=>candidates.some(c=>c.id===r.id&&c.lease===r.lease)).map(r=>({id:r.id,lease:r.lease}));
 }
 async function deliveredReplay(principal,id){
  const [rows]=await read([sql(`SELECT CASE WHEN length(CAST(input_json AS BLOB))<=1024 THEN input_json ELSE NULL END input_json,CASE WHEN length(CAST(result_json AS BLOB))<=128 THEN result_json ELSE NULL END result_json,request_digest,output_digest,state,created_ms FROM app_command_receipts WHERE principal_key=? AND operation_kind=? AND business_key=? AND request_key=?`,'operator:'+principal.id,DELIVER_NOTICE,id,id)]);
  const r=rows[0];if(!r)return null;if(r.state!=='committed')return pending('notice-delivery-incomplete');
  try{const input=JSON.parse(r.input_json),c=await buildDeliverNoticeCommand({principal,input},crypto);if(input.id!==id||c.nowMs!==r.created_ms||c.requestDigest!==r.request_digest||r.result_json!==canonicalJson({state:'delivered',id})||await crypto.sha256(utf8(r.result_json))!==r.output_digest)return pending('notice-delivery-receipt-invalid');return {state:'delivered',id};}catch{return pending('notice-delivery-receipt-invalid');}
 }
 async function finishLease(principal,request,jobLease){
  const p=noticeWorkerPrincipal(principal),r=structuredClone(request),lease=jobLease===undefined?undefined:structuredClone(jobLease);if(!r||Object.keys(r).some(k=>!['id','lease','outcome'].includes(k))||typeof r.id!=='string'||!/^[a-f0-9]{64}$/.test(r.id)||typeof r.lease!=='string'||r.lease.length<1||r.lease.length>256||!['delivered','retryable','unknown'].includes(r.outcome??'delivered'))throw new TypeError('Invalid notice finish.');
  const prior=await deliveredReplay(p,r.id);if(prior)return prior;const bound=await deliveryJobFence(p,r.id,lease),ctx=await controls(p);if(!isWritable(ctx.recovery))return pending('read-only-recovery');
  const [rows]=await read([sql(`SELECT id,wallet,consent_revision,attempts,lease,lease_until_ms,state,expires_ms,${currentConsent} AS consent FROM notice_outbox WHERE id=?`,r.id)]),row=rows[0];
  if(!row||row.state!=='leased'||row.lease!==r.lease||row.lease_until_ms<=ctx.now)return {state:'fenced'};
  const fence=workerVersion(ctx.version),base=`id=? AND state='leased' AND lease=? AND lease_until_ms>? AND ${writable} AND ${bound.text}`,values=[r.id,r.lease,ctx.now,ctx.recovery.generation,...bound.values];
  if(!row.consent||row.expires_ms<=ctx.now){const out=await driver.batch([sql(`UPDATE notice_outbox SET state='cancelled',lease=NULL,lease_until_ms=NULL WHERE ${base}`, ...values)]);return {state:out[0].changes>0?'cancelled':'fenced'};}
  if(!ctx.granted)return conflict('operator_scope_required');
  const outcome=r.outcome??'delivered';
  if(!ctx.decision.allowed||outcome!=='delivered'){
   const next=!ctx.decision.allowed||outcome==='retryable'?(row.attempts>=5?'cancelled':'retry'):'unknown',ready=ctx.now+Math.min(3600000,60000*2**(row.attempts-1));
   const out=await driver.batch([sql(`UPDATE notice_outbox SET state=?,ready_ms=?,lease=NULL,lease_until_ms=NULL WHERE ${base} AND ${currentConsent} AND expires_ms>${nowSql} AND ${grant} AND ${fence.text} AND ${nowSql}>=? AND ${nowSql}<?`,next,ready,...values,p.id,...fence.values,ctx.now,ctx.now+30000)]);return {state:out[0].changes>0?next:'fenced'};
  }
  const input={id:r.id,wallet:row.wallet,consentRevision:row.consent_revision,attempt:row.attempts,deliveredMs:ctx.now},c=await buildDeliverNoticeCommand({principal:p,input},crypto),result={state:'delivered',id:r.id};
  const accepted=await execute({...c,expectedRevisions:ctx.version},{businessKey:r.id,input,result,resultRef:r.id,version:ctx.version,
   authoritySql:`${grant} AND ${writable} AND ${nowSql}>=? AND ${nowSql}<? AND EXISTS(SELECT 1 FROM notice_outbox WHERE id=? AND wallet=? AND state='leased' AND lease=? AND lease_until_ms>${nowSql} AND expires_ms>${nowSql} AND consent_revision=? AND attempts=? AND ${currentConsent}) AND ${bound.text}`,authorityValues:[p.id,ctx.recovery.generation,ctx.now,ctx.now+30000,r.id,row.wallet,r.lease,row.consent_revision,row.attempts,...bound.values],
   child:(gate,v)=>[sql(`INSERT INTO notice_inbox(id,wallet,delivered_ms) SELECT ?,?,? WHERE ${gate}`,r.id,row.wallet,ctx.now,...v),sql(`UPDATE notice_outbox SET state='delivered',lease=NULL,lease_until_ms=NULL WHERE id=? AND state='leased' AND lease=? AND ${gate}`,r.id,r.lease,...v)]});
  if(['committed','replayed'].includes(accepted.kind))return result;
  return await deliveredReplay(p,r.id)??accepted;
 }
 async function reconcileUnknown(principal,request,jobLease){
  const p=noticeWorkerPrincipal(principal),{id}=structuredClone(request),lease=jobLease===undefined?undefined:structuredClone(jobLease);if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new TypeError('Invalid notice ID.');
  if(lease!==undefined){const accepted=await deliveredReplay(p,id);if(accepted)return accepted;}
  const bound=await deliveryJobFence(p,id,lease),now=at(),[recovery,rows,allowed]=await read([recoverySql,sql(`SELECT state,wallet,${currentConsent} AS consent,expires_ms,attempts FROM notice_outbox WHERE id=?`,id),sql(`SELECT 1 AS allowed WHERE ${bound.text}`,...bound.values)]);
  if(!isWritable(recovery[0]))return pending('read-only-recovery');if(!allowed.length)return pending('notice-job-fenced');const row=rows[0];if(!row)return {state:'missing'};
  if(row.state==='delivered'&&lease!==undefined){const [receipt]=await read([sql('SELECT 1 FROM notice_inbox WHERE id=? AND wallet=?',id,row.wallet)]);return receipt.length?{state:'delivered'}:pending('notice-delivery-receipt-missing');}
  if(row.state!=='unknown')return {state:row.state};
  const [receipt]=await read([sql('SELECT 1 FROM notice_inbox WHERE id=? AND wallet=?',id,row.wallet)]),state=receipt.length?'delivered':row.consent&&row.expires_ms>now&&row.attempts<5?'retry':'cancelled';
  const result=await driver.batch([sql(`UPDATE notice_outbox SET state=?,ready_ms=?,lease=NULL,lease_until_ms=NULL WHERE id=? AND state='unknown' AND ${writable} AND (?='delivered' OR ?='cancelled' OR (${currentConsent} AND expires_ms>${nowSql} AND attempts<5)) AND ${bound.text}`,state,now,id,recovery[0].generation,state,state,...bound.values)]);
  if(result[0].changes>0)return {state};const [current]=await read([sql('SELECT state FROM notice_outbox WHERE id=?',id)]);return {state:current[0]?.state??'missing'};
 }
 async function purgeExpired(principal,options={},jobLease){
  const p=noticeWorkerPrincipal(principal),input=structuredClone(options),lease=jobLease===undefined?null:structuredClone(jobLease),now=at();
  if(!input||Object.keys(input).some(k=>k!=='limit'))throw new TypeError('Invalid notification retention options.');
  const limit=input.limit??100;if(!Number.isInteger(limit)||limit<1||limit>100)throw new TypeError('Purge 1-100 notices.');
  if(lease&&(!Object.keys(lease).every(k=>['jobId','businessKey','payloadDigest','token','expiresAtMs','revision','attempt'].includes(k))||typeof lease.jobId!=='string'||lease.jobId.length>128||typeof lease.token!=='string'||lease.token.length<1||lease.token.length>256||typeof lease.payloadDigest!=='string'||!/^[a-f0-9]{64}$/.test(lease.payloadDigest)||typeof lease.revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(lease.revision)||!Number.isSafeInteger(Number(lease.revision))||!Number.isInteger(lease.attempt)||lease.attempt<1||!Number.isSafeInteger(lease.expiresAtMs)))throw new TypeError('Invalid retention job lease.');
  const [recovery,jobs]=await read([recoverySql,...(lease?[sql("SELECT CASE WHEN length(CAST(payload_json AS BLOB))<=1024 THEN payload_json ELSE NULL END payload_json,source_key FROM app_jobs WHERE id=? AND principal=? AND type='retention-maintenance'",lease.jobId,p.id)]:[])]);
  if(!isWritable(recovery[0]))return pending('read-only-recovery');
  let guard=`${writable} AND ${nowSql}>=? AND ${nowSql}<?`,values=[recovery[0].generation,now,now+30000];
  if(lease){
   let payload;try{payload=retentionPayload(JSON.parse(jobs[0]?.payload_json));}catch{return pending('retention-job-binding');}
   const body=canonicalJson(payload),digest=await crypto.sha256(utf8(body));
   if(payload.limit!==limit||retentionBusinessKey(payload)!==lease.businessKey||jobs[0].source_key!==retentionSourceKey(payload)||digest!==lease.payloadDigest)return pending('retention-job-binding');
   guard+=` AND EXISTS(SELECT 1 FROM app_jobs WHERE id=? AND principal=? AND type='retention-maintenance' AND business_key=? AND source_key=? AND payload_json=? AND payload_digest=? AND state='running' AND lease_token=? AND revision=? AND attempt=? AND lease_until_ms=? AND lease_until_ms>${nowSql}) AND EXISTS(SELECT 1 FROM app_execution_fences WHERE business_key=? AND holder_token=? AND revision=? AND payload_digest=? AND expires_ms=? AND expires_ms>${nowSql}) AND EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='jobs-runner' AND enabled=1)`;
   values.push(lease.jobId,p.id,lease.businessKey,retentionSourceKey(payload),body,digest,lease.token,Number(lease.revision),lease.attempt,lease.expiresAtMs,lease.businessKey,lease.token,Number(lease.revision),digest,lease.expiresAtMs,p.id);
  }
  try{
   // WITH keeps RETURNING on the portable driver's row-producing path. Counts
   // deliberately exclude D1 metadata changes caused by cascaded inbox deletes.
   const result=await driver.batch([
    sql(`WITH due AS(SELECT id FROM notice_outbox WHERE expires_ms<=? ORDER BY expires_ms,id LIMIT ?) DELETE FROM notice_outbox WHERE id IN(SELECT id FROM due) AND ${guard} RETURNING id`,now-7*DAY,limit,...values),
    sql(`SELECT 1 AS allowed WHERE ${guard}`,...values)
   ]);
   if(!result[1].rows.length)return pending('retention-fenced');
   if(result[0].rows.length>limit||result[0].rows.some(row=>typeof row.id!=='string'))return pending('retention-result-invalid');
   return {kind:'purged',outboxRemoved:result[0].rows.length,consentRequestKeysRemoved:0};
  }catch{return pending('retention-outcome-unknown');}
 }
 return Object.freeze({enqueueNotice,readInbox,leaseDue,finishLease,reconcileUnknown,purgeExpired});
}
