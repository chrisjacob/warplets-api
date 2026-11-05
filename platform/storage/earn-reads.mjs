import {sql,revisions} from './atomic-driver.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {DAY_MS,claimableUnits,epochAt,onboardingTenths} from '../domain/earn/index.mjs';
import {name,nat,EarnError} from '../earn/validation.mjs';
import {pressureFromRows,decisionFromRows} from '../operations/portable-controls.mjs';
import {displayMemberStatus} from '../earn/member-display.mjs';
import {admissionRead} from '../pricing/admission-read.mjs';
class Unavailable extends Error{}
const hold=reason=>{throw new Unavailable(reason);};
const pending=reason=>({kind:'pending',reason,dependencyIds:[]});
const bounded=(rows,max,label)=>{if(rows.length>max)hold(label+'-bound');return rows;};
function json(value,label){if(typeof value!=='string'||utf8(value).length>256*1024)hold(label+'-bound');try{return JSON.parse(value);}catch{hold(label+'-invalid');}}
function walletOf(principal){if(principal?.kind!=='wallet')throw new EarnError(401,'authentication_required','Connect your wallet.');return name(principal.wallet,'wallet');}
const activeActions=epoch=>sql(`SELECT a.id AS actionId,a.label,a.verifier,c.effective_epoch AS startEpoch FROM earn_action_catalog a
 JOIN earn_action_changes c ON c.action_id=a.id AND c.effective_epoch=(SELECT MAX(z.effective_epoch) FROM earn_action_changes z WHERE z.action_id=a.id AND z.effective_epoch<=?)
 WHERE c.enabled=1 ORDER BY a.id LIMIT 101`,epoch);
function controlStatements(epoch,nowMs){return [
 sql('SELECT * FROM earn_workload_policies WHERE effective_epoch<=? AND recorded_ms<=? ORDER BY effective_epoch DESC,recorded_ms DESC LIMIT 1',epoch,nowMs),
 sql('SELECT admitted FROM earn_admission_counts WHERE epoch=?',epoch),
 sql("SELECT paused,revision FROM ops_scope_log WHERE scope='earn-admission' AND at_ms<=? ORDER BY at_ms DESC LIMIT 1",nowMs),
 sql(`SELECT * FROM ops_usage u WHERE u.at_ms<=? AND NOT EXISTS(SELECT 1 FROM ops_usage n WHERE n.provider=u.provider
  AND n.metric=u.metric AND (u.metric='new-monthly-usd' OR n.period=u.period) AND n.at_ms>u.at_ms AND n.at_ms<=?)
  AND (u.metric='new-monthly-usd' OR u.period=?) ORDER BY u.provider LIMIT 101`,nowMs,nowMs,new Date(nowMs).toISOString().slice(0,10)),
 sql("SELECT * FROM ops_optional_spend WHERE at_ms<=? AND (status='reserved' OR COALESCE(settled_ms,at_ms)>=?) LIMIT 101",nowMs,Date.parse(new Date(nowMs).toISOString().slice(0,7)+'-01T00:00:00Z')),
 ];}
function controls(rows,epoch,nowMs){
 const [policies,counts,scopes,usage,spend]=rows,pressure=pressureFromRows(usage,spend,nowMs),decision=decisionFromRows('earn-admission',scopes[0],pressure);
 const policy=policies[0];if(!policy)return {capacity:null,decision,unavailable:'staffing-required'};
 const limit=Math.min(policy.admission_limit,Math.floor(policy.staffed_minutes*60/policy.seconds_per_review)),admitted=counts[0]?.admitted??0,remaining=Math.max(0,limit-admitted);
 return {capacity:{epoch,limit,admitted,remaining,accepting:epochAt(nowMs)===epoch&&remaining>0,policy:policy.revision},decision,unavailable:pressure.status==='pending'?pressure.reason:null};
}
export function createEarnReadRepository(driver){
 const read=async statements=>(await driver.batch(statements)).map(r=>r.rows);
 async function stable(project){
  try{
   const [before,recovered]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),sql('SELECT 1 FROM earn_recovered_boards LIMIT 1')]);
   const result=await project(!!recovered.length);
   const [after]=await read([sql('SELECT * FROM app_revisions ORDER BY name')]);
   if(canonicalJson(revisions(before))!==canonicalJson(revisions(after)))return pending('revision_conflict');
   if(utf8(canonicalJson(result)).length>256*1024)return pending('read-response-bound');return result;
  }catch(error){if(error instanceof Unavailable)return pending(error.message);throw error;}
 }
 async function member(wallet,nowMs,recovery){
  const epoch=epochAt(nowMs),rows=await read([...controlStatements(epoch,nowMs),
   sql('SELECT 1 FROM earn_boards WHERE epoch=?',epoch),
   sql('SELECT token_id FROM earn_fixture_campaigns WHERE activation_ms<=? AND activation_ms+?>? ORDER BY token_id LIMIT 11',nowMs,10*DAY_MS,nowMs),
   sql(`SELECT a.id AS actionId,a.label,a.verifier,c.effective_epoch AS startEpoch,v.verified_ms,v.source_ref FROM earn_action_catalog a
    JOIN earn_action_changes c ON c.action_id=a.id AND c.effective_epoch=(SELECT MAX(z.effective_epoch) FROM earn_action_changes z WHERE z.action_id=a.id AND z.effective_epoch<=?)
    LEFT JOIN earn_action_completions v ON v.action_id=a.id AND v.wallet=? AND v.verifier=a.verifier AND v.verified_ms<=?
    WHERE c.enabled=1 ORDER BY a.id LIMIT 101`,epoch,wallet,nowMs),
   sql(`SELECT f.epoch,f.payload,f.source_ref,b.snapshot_hash,s.days AS streak_days FROM earn_member_facts f JOIN earn_boards b ON b.epoch=f.epoch
    LEFT JOIN earn_streaks s ON s.epoch=f.epoch AND s.wallet=f.wallet WHERE f.wallet=? AND b.finalized_ms<=? ORDER BY f.epoch DESC LIMIT 1`,wallet,nowMs),
  ]);
  const control=controls(rows.slice(0,5),epoch,nowMs),[closed,campaigns,actions,finals]=rows.slice(5),observations=new Map(),accepted=new Set();
  const unavailable=campaigns.length>10?'campaign-bound':control.unavailable;
  if(!unavailable&&campaigns.length){
   const details=await read(campaigns.flatMap(c=>[
    sql(`SELECT o.receipt,o.decision,o.as_of_ms,o.policy_hash,p.policy_hash AS source_policy_hash,r.id,r.wallet AS read_wallet,r.token_id AS read_token,
      r.observed_ms AS read_observed_ms,r.expires_ms AS read_expires_ms,r.micro_usd FROM price_observations o
      LEFT JOIN earn_stake_reads r ON r.id=o.read_id JOIN price_sources p ON p.token_id=o.token_id
      WHERE o.wallet=? AND o.token_id=? AND o.as_of_ms<=? ORDER BY o.as_of_ms DESC,o.revision DESC LIMIT 1`,wallet,c.token_id,nowMs),
    sql('SELECT id FROM earn_submissions WHERE epoch=? AND wallet=? AND token_id=?',epoch,wallet,c.token_id),
   ]));
   campaigns.forEach((c,i)=>{const row=details[i*2][0];let value={status:'pending',reason:'missing-observation'};
    if(row){
     let decision;try{if(typeof row.decision==='string'&&utf8(row.decision).length<=256*1024)decision=JSON.parse(row.decision);}catch{}
     if(decision?.status==='pending')value={...decision,receipt:row.receipt,asOfMs:row.as_of_ms};
     else {const checked=admissionRead(row,{wallet,tokenId:c.token_id,nowMs});value=checked.status==='verified'?checked:{...checked,receipt:row.receipt};}
    }
    observations.set(c.token_id,value);if(details[i*2+1].length)accepted.add(c.token_id);
   });
  }
  return displayMemberStatus({nowMs,epoch,recovery,...control,boardClosed:!!closed.length,campaigns,observations,accepted,actions,final:finals[0],
   finalPayload:finals[0]?json(finals[0].payload,'member-components'):null,unavailable});
 }
 return Object.freeze({
  async readLeaderboard({epoch}){
   nat(epoch,'epoch');const date=new Date(epoch*DAY_MS).toISOString().slice(0,10);
   return stable(async recovery=>{
    const [boards,rows]=await read(recovery?[
     sql('SELECT board_json FROM earn_recovered_boards WHERE epoch=?',epoch),sql('SELECT allocation_json FROM earn_recovered_allocations WHERE epoch=? ORDER BY token_id LIMIT 101',epoch),
    ]:[sql('SELECT winners,snapshot_hash,finalized_ms FROM earn_boards WHERE epoch=?',epoch),
     sql('SELECT token_id AS tokenId,day,budget AS budgetUnits,burn AS burnUnits,vests_from_ms AS vestsFromMs,vests_through_ms AS vestsThroughMs FROM earn_allocations WHERE epoch=? ORDER BY token_id,day LIMIT 101',epoch)]);
    bounded(rows,100,'allocation');const row=boards[0],board=recovery&&row?json(row.board_json,'board'):null;
    const winners=row?(recovery?board.winners:json(row.winners,'board')):[];if(!Array.isArray(winners))hold('board-invalid');bounded(winners,100,'board');
    const allocations=recovery?rows.map(r=>{const a=json(r.allocation_json,'allocation');return Object.fromEntries(['tokenId','day','budgetUnits','burnUnits','vestsFromMs','vestsThroughMs'].map(k=>[k,a[k]]));}):rows;
    return {mode:'local-fixture',...(recovery?{source:'public-archive'}:{}),epoch,date,status:row?'final':'pending',items:winners.map((w,i)=>({rank:i+1,...w})),allocations,
     snapshotId:row?(recovery?board.snapshotId:row.snapshot_hash):null,finalizedAtMs:row?(recovery?board.finalizedAtMs:row.finalized_ms):null};
   });
  },
  async readWalletClaims({principal,nowMs,after=0}){
   const wallet=walletOf(principal);nat(nowMs,'now');nat(after,'cursor');
   return stable(async recovery=>{
    const [rows]=await read([recovery?sql(`SELECT rowid AS cursor,token_id AS tokenId,day,amount AS amount,vests_from_ms AS vestsFromMs,vests_through_ms AS vestsThroughMs
     FROM earn_recovered_awards WHERE wallet=? AND rowid>? ORDER BY rowid LIMIT 51`,wallet,after):sql(`SELECT a.rowid AS cursor,a.token_id AS tokenId,a.day,a.amount,c.vests_from_ms AS vestsFromMs,c.vests_through_ms AS vestsThroughMs
     FROM earn_awards a JOIN earn_allocations c ON c.token_id=a.token_id AND c.day=a.day WHERE a.wallet=? AND a.rowid>? ORDER BY a.rowid LIMIT 51`,wallet,after)]);
    const items=rows.slice(0,50).map(row=>({tokenId:row.tokenId,day:row.day,awardUnits:row.amount,vestedUnits:String(claimableUnits({awardedUnits:BigInt(row.amount),claimedUnits:0n,window:row,nowMs})),vestsFromMs:row.vestsFromMs,vestsThroughMs:row.vestsThroughMs}));
    return {mode:'local-fixture',...(recovery?{source:'public-archive'}:{}),executionEnabled:false,items,nextCursor:rows.length>50?rows[49].cursor:null};
   });
  },
  async readWalletSubmissions({principal,nowMs,after=0}){
   const wallet=walletOf(principal);nat(nowMs,'now');nat(after,'cursor');
   return stable(async recovery=>{
    const [rows]=await read([sql(`SELECT s.rowid AS cursor,s.*,b.snapshot_hash,r.content_score,r.reason,d.qualified,f.payload AS member_payload,f.source_ref AS member_source,sk.days AS streak_days,
     e.micro_usd AS entry_stake,c.micro_usd AS closing_stake FROM earn_submissions s LEFT JOIN earn_boards b ON b.epoch=s.epoch
     LEFT JOIN earn_reviews r ON r.submission_id=s.id LEFT JOIN earn_decisions d ON d.submission_id=s.id
     LEFT JOIN earn_member_facts f ON f.epoch=s.epoch AND f.wallet=s.wallet LEFT JOIN earn_streaks sk ON sk.epoch=s.epoch AND sk.wallet=s.wallet
     JOIN earn_stake_reads e ON e.id=s.entry_read_id LEFT JOIN earn_stake_reads c ON c.id=d.snapshot_read_id
     WHERE s.wallet=? AND s.rowid>? ORDER BY s.rowid LIMIT 51`,wallet,after)]);
    const items=rows.slice(0,50).map(row=>{
     let components=null;if(row.snapshot_hash&&row.member_payload){const m=json(row.member_payload,'member-components');components={actionTenths:onboardingTenths(row.epoch,m.intervals,m.completions),streakDays:row.streak_days??0,
      highestEligibleLevel:m.highestEligibleLevel,purchaseTokenDays:m.purchaseTokenDays,sourceRef:row.member_source};}
     return {id:row.id,tokenId:row.token_id,epoch:row.epoch,url:row.url,submittedAtMs:row.submitted_ms,status:row.snapshot_hash?'final':'pending',
      score:row.snapshot_hash?row.content_score:null,eligible:row.snapshot_hash?Boolean(row.qualified):null,reason:row.snapshot_hash?row.reason:null,components,
      entryStakeMicroUsd:row.entry_stake,closingStakeMicroUsd:row.snapshot_hash?row.closing_stake:null};
    });
    return {mode:'local-fixture',items,nextCursor:rows.length>50?rows[49].cursor:null,memberStatus:await member(wallet,nowMs,recovery)};
   });
  },
  async readCapacity({nowMs}){
   nat(nowMs,'now');const epoch=epochAt(nowMs);
   return stable(async recovery=>{const control=controls(await read(controlStatements(epoch,nowMs)),epoch,nowMs);
    if(control.unavailable)hold(control.unavailable);return {mode:'local-fixture',...control.capacity,accepting:!recovery&&control.capacity.accepting&&control.decision.allowed};});
  },
  async readActions({nowMs}){
   nat(nowMs,'now');const epoch=epochAt(nowMs);return stable(async()=>{const [items]=await read([activeActions(epoch)]);bounded(items,100,'action');return {epoch,mode:'local-fixture',items};});
  },
 });
}
