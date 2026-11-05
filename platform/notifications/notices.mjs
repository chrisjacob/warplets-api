import { randomUUID } from 'node:crypto';
import { DAY_MS } from '../domain/earn/index.mjs';
import { transaction } from '../storage/database.mjs';
import { actionDecision } from '../operations/controls.mjs';
import { conflict, digest, name, nat, requireValue } from '../earn/checks.mjs';

export const TERMS='10x-notice-local-inbox-v1';
const channel='local-inbox',topics=Object.freeze(['launch','voting','rewards']);
export const noticeCapabilities=Object.freeze({channel,topics,terms:TERMS,delivery:'in-app fixture only',externalTransport:false,dailyLimit:3});
function consentArgs(wallet,chan) {
  name(wallet,'wallet');requireValue(chan===channel,'Only the local inbox channel is available.');
}
export function preferences(db,wallet,chan=channel) {
  consentArgs(wallet,chan);
  const row=db.prepare('SELECT * FROM notice_preferences WHERE wallet=? AND channel=?').get(wallet,chan);
  return {channel:chan,revision:row?.revision??0,enabled:Boolean(row?.enabled),topics:row?JSON.parse(row.topics):[],terms:TERMS,
    changedAtMs:row?.changed_ms??null};
}
export function setConsent(db,{wallet,channel:chan,enabled,selectedTopics=[],terms,expectedRevision,requestKey,now}) {
  consentArgs(wallet,chan);nat(now,'now');nat(expectedRevision,'expected revision');name(requestKey,'idempotency key');
  requireValue(typeof enabled==='boolean'&&terms===TERMS,'Explicit channel consent with the current term version is required.');
  requireValue(Array.isArray(selectedTopics)&&selectedTopics.every(t=>topics.includes(t))&&new Set(selectedTopics).size===selectedTopics.length,
    'Choose supported topics once.');
  requireValue(enabled?selectedTopics.length>0:!selectedTopics.length,'Enabled subscriptions require topics; revoke with an empty list.');
  const selected=[...selectedTopics].sort(), hash=digest([chan,enabled,selected,terms,expectedRevision]);
  return transaction(db,()=>{
    const replay=db.prepare('SELECT * FROM notice_consent_requests WHERE wallet=? AND channel=? AND request_key=?').get(wallet,chan,requestKey);
    if(replay) {
      if(replay.request_hash!==hash)conflict('key_conflict','Consent key was used for different settings.');
      return {appliedRevision:replay.revision,preference:preferences(db,wallet),replay:true};
    }
    const before=preferences(db,wallet,chan);
    if(before.revision!==expectedRevision || now<(before.changedAtMs??0)) conflict('consent_conflict','Refresh your preferences before updating.');
    const revision=before.revision+1;
    db.prepare(`INSERT INTO notice_preferences VALUES(?,?,?,?,?,?,?) ON CONFLICT(wallet,channel) DO UPDATE SET
      revision=excluded.revision,enabled=excluded.enabled,topics=excluded.topics,terms=excluded.terms,changed_ms=excluded.changed_ms`)
      .run(wallet,chan,revision,Number(enabled),JSON.stringify(selected),TERMS,now);
    db.prepare('INSERT INTO notice_consent_requests VALUES(?,?,?,?,?,?)').run(wallet,chan,requestKey,hash,revision,now);
    // In-flight work is fenced by consent revision. Opt-out is never blocked by a budget pause.
    db.prepare("UPDATE notice_outbox SET state='cancelled',lease=NULL,lease_until_ms=NULL WHERE wallet=? AND channel=? AND state IN ('queued','retry','leased','unknown')")
      .run(wallet,chan);
    if(!enabled)db.prepare('DELETE FROM notice_inbox WHERE wallet=?').run(wallet);
    return {appliedRevision:revision,preference:preferences(db,wallet),replay:false};
  });
}

function fromSource(db,{wallet,topic,subject,now}) {
  if(topic==='launch') {
    name(subject,'market');const row=db.prepare('SELECT body FROM market_fixtures WHERE id=?').get(subject);
    if(!row)return null;
    const market=JSON.parse(row.body), starts=Date.parse(market.activatedAt);
    if(!Number.isFinite(starts)||now<starts||now>=starts+DAY_MS)return null;
    return {title:'Market opened',message:'A local ATT campaign is available.',target:'/markets/'+encodeURIComponent(subject),
      expires:starts+DAY_MS,key:subject};
  }
  if(topic==='voting') {
    name(subject,'ballot');const ballot=db.prepare(`SELECT b.* FROM genesis_ballots b JOIN genesis_voters v ON v.ballot_id=b.id
      WHERE b.id=? AND v.wallet=?`).get(subject,wallet);
    if(!ballot||now<ballot.opens_ms||now>=ballot.closes_ms)return null;
    return {title:'Genesis vote is open',message:'This wallet is eligible to advise the next Genesis opening.',
      target:'/collections/genesis',expires:ballot.closes_ms,key:subject};
  }
  requireValue(subject&&typeof subject==='object','Reward requires a token and campaign day.');
  name(subject.tokenId,'token');requireValue(Number.isInteger(subject.day)&&subject.day>=1&&subject.day<=10,'Invalid campaign day.');
  const row=db.prepare(`SELECT a.amount,c.epoch,c.vests_from_ms,c.vests_through_ms FROM earn_awards a JOIN earn_allocations c
    ON a.token_id=c.token_id AND a.day=c.day WHERE a.wallet=? AND a.token_id=? AND a.day=?`).get(wallet,subject.tokenId,subject.day);
  if(!row||BigInt(row.amount)===0n||now<=row.vests_from_ms||now>=row.vests_through_ms+DAY_MS)return null;
  return {title:'Earn award is vesting',message:'Review your local Earn award and its release window.',
    target:'/earn/'+new Date(row.epoch*DAY_MS).toISOString().slice(0,10),expires:row.vests_through_ms+DAY_MS,
    key:JSON.stringify([subject.tokenId,subject.day])};
}
export function enqueueNotice(db,{wallet,topic,subject,now}) {
  consentArgs(wallet,channel);nat(now,'now');requireValue(topics.includes(topic),'Unsupported notice topic.');
  return transaction(db,()=>{
    const prefs=preferences(db,wallet);
    if(!prefs.enabled||!prefs.topics.includes(topic))return {state:'skipped',reason:'no-consent'};
    if(!actionDecision(db,'optional-notifications',now).allowed)return {state:'held',reason:'delivery-paused'};
    const data=fromSource(db,{wallet,topic,subject,now});
    if(!data)return {state:'skipped',reason:'no-current-event'};
    const id=digest([TERMS,wallet,topic,data.key]);
    const prior=db.prepare('SELECT state FROM notice_outbox WHERE id=?').get(id);
    if(prior)return {state:prior.state,id,replay:true};
    const start=Math.floor(now/DAY_MS)*DAY_MS;
    if(db.prepare('SELECT COUNT(*) AS n FROM notice_outbox WHERE wallet=? AND created_ms>=? AND created_ms<?').get(wallet,start,start+DAY_MS).n>=3) {
      return {state:'skipped',reason:'daily-cap'};
    }
    db.prepare("INSERT INTO notice_outbox VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued',0,?,NULL,NULL)").run(id,wallet,channel,prefs.revision,topic,
      data.key,data.title,data.message,data.target,now,data.expires,now);
    return {state:'queued',id,replay:false};
  });
}

function stillConsented(db,row,now) {
  const pref=preferences(db,row.wallet,row.channel);
  return pref.enabled&&pref.revision===row.consent_revision&&pref.topics.includes(row.topic)&&now<row.expires_ms;
}
function cancel(db,id) {
  db.prepare("UPDATE notice_outbox SET state='cancelled',lease=NULL,lease_until_ms=NULL WHERE id=?").run(id);
}
export function leaseDue(db,{now,limit=20}) {
  nat(now,'now');requireValue(Number.isInteger(limit)&&limit>=1&&limit<=20,'Lease 1–20 notices at once.');
  return transaction(db,()=>{
    // A local inbox receipt is authoritative. An expired lease with no receipt is
    // marked unknown until explicitly reconciled, never sent on a timer alone.
    const expired=db.prepare("SELECT id FROM notice_outbox WHERE state='leased' AND lease_until_ms<=? ORDER BY lease_until_ms LIMIT 20").all(now);
    for(const row of expired) {
      const sent=db.prepare('SELECT 1 FROM notice_inbox WHERE id=?').get(row.id);
      db.prepare('UPDATE notice_outbox SET state=?,lease=NULL,lease_until_ms=NULL WHERE id=?').run(sent?'delivered':'unknown',row.id);
    }
    if(!actionDecision(db,'optional-notifications',now).allowed)return [];
    const rows=db.prepare("SELECT * FROM notice_outbox WHERE state IN ('queued','retry') AND ready_ms<=? ORDER BY ready_ms,id LIMIT ?").all(now,limit);
    const leases=[];
    for(const row of rows) {
      if(!stillConsented(db,row,now)||row.attempts>=5){cancel(db,row.id);continue;}
      const lease=randomUUID();
      db.prepare("UPDATE notice_outbox SET state='leased',attempts=attempts+1,lease=?,lease_until_ms=? WHERE id=?").run(lease,now+30_000,row.id);
      leases.push({id:row.id,lease});
    }
    return leases;
  });
}
export function finishLease(db,{id,lease,now,outcome='delivered'}) {
  name(id,'notice');name(lease,'lease');nat(now,'now');
  requireValue(['delivered','retryable','unknown'].includes(outcome),'Unknown local transport result.');
  return transaction(db,()=>{
    const row=db.prepare('SELECT * FROM notice_outbox WHERE id=?').get(id);
    if(!row||row.state!=='leased'||row.lease!==lease||row.lease_until_ms<=now) return {state:'fenced'};
    if(!stillConsented(db,row,now)){cancel(db,id);return {state:'cancelled'};}
    const held=!actionDecision(db,'optional-notifications',now).allowed;
    if(held||outcome==='retryable') {
      if(row.attempts>=5){cancel(db,id);return {state:'cancelled'};}
      db.prepare("UPDATE notice_outbox SET state='retry',ready_ms=?,lease=NULL,lease_until_ms=NULL WHERE id=?")
        .run(now+Math.min(3600000,60000*2**(row.attempts-1)),id);
      return {state:'retry'};
    }
    if(outcome==='unknown') {
      db.prepare("UPDATE notice_outbox SET state='unknown',lease=NULL,lease_until_ms=NULL WHERE id=?").run(id);
      return {state:'unknown'};
    }
    db.prepare('INSERT INTO notice_inbox VALUES(?,?,?)').run(id,row.wallet,now);
    db.prepare("UPDATE notice_outbox SET state='delivered',lease=NULL,lease_until_ms=NULL WHERE id=?").run(id);
    return {state:'delivered'};
  });
}
export function reconcileUnknown(db,{id,now}) {
  name(id,'notice');nat(now,'now');
  return transaction(db,()=>{
    const row=db.prepare('SELECT * FROM notice_outbox WHERE id=?').get(id);
    requireValue(row,'Unknown notice.');
    if(row.state!=='unknown') return {state:row.state};
    const receipt=db.prepare('SELECT 1 FROM notice_inbox WHERE id=?').get(id);
    const state=receipt?'delivered':stillConsented(db,row,now)&&row.attempts<5?'retry':'cancelled';
    db.prepare('UPDATE notice_outbox SET state=?,ready_ms=? WHERE id=?').run(state,now,id);
    return {state};
  });
}
export function inbox(db,{wallet,now,beforeMs=Number.MAX_SAFE_INTEGER,beforeId='~',limit=25}) {
  name(wallet,'wallet');nat(now,'now');nat(beforeMs,'cursor');name(beforeId,'cursor ID');
  requireValue(Number.isInteger(limit)&&limit>=1&&limit<=50,'Page size 1–50.');
  const rows=db.prepare(`SELECT o.id,o.topic,o.title,o.message,o.target,i.delivered_ms AS deliveredMs
    FROM notice_inbox i JOIN notice_outbox o ON o.id=i.id WHERE i.wallet=? AND o.expires_ms>?
    AND (i.delivered_ms<? OR (i.delivered_ms=? AND i.id<?)) ORDER BY i.delivered_ms DESC,i.id DESC LIMIT ?`)
    .all(wallet,now,beforeMs,beforeMs,beforeId,limit+1);
  const page=rows.slice(0,limit),last=page.at(-1);
  return {mode:'local-inbox',items:page,nextCursor:rows.length>limit?`${last.deliveredMs}.${last.id}`:null};
}
export function purgeExpired(db,{now}) {
  nat(now,'now');
  return transaction(db,()=>{
    const outbox=db.prepare('DELETE FROM notice_outbox WHERE id IN (SELECT id FROM notice_outbox WHERE expires_ms<=? LIMIT 100)').run(now-DAY_MS*7);
    const consent=db.prepare('DELETE FROM notice_consent_requests WHERE rowid IN (SELECT rowid FROM notice_consent_requests WHERE changed_ms<? LIMIT 100)').run(now-30*DAY_MS);
    return {outboxRemoved:outbox.changes,consentRequestKeysRemoved:consent.changes};
  });
}
