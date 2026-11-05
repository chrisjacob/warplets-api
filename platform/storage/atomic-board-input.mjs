import { sql,revisions } from './atomic-driver.mjs';
import { canonicalJson,utf8 } from '../security/canonical.mjs';
import { componentPlan } from '../earn/component-plan.mjs';
import { DAY_MS,MIN_STAKE_MICRO_USD } from '../domain/earn/index.mjs';
import { nat,name } from '../earn/validation.mjs';
const pending=(reason)=>({kind:'pending',reason,dependencyIds:[]});
const bounded=rows=>rows.length<=100;
function valuation(row,cutoff) {
  if(!row)return {status:'pending',reason:'missing-observation'};
  const value=JSON.parse(row.decision);
  if(value.status==='verified'&&value.expiresMs<cutoff)return {status:'pending',reason:'stale-or-future'};
  return {...value,receipt:row.receipt,asOfMs:row.as_of_ms};
}
// This loads data, not a completeness assertion. B05 must seal coverage before
// a B07 service may publish a decision. Multi-batch reads recheck all revisions.
export async function loadAtomicBoardInput(driver,crypto,{epoch,nowMs,sourceRef}) {
  nat(epoch,'epoch');nat(nowMs,'now');name(sourceRef,'source reference');const cutoff=(epoch+1)*DAY_MS-1;
  if(nowMs<=cutoff)return pending('board-open');
  let readBatches=0;
  const read=async statements=>{readBatches++;return (await driver.batch(statements)).map(r=>r.rows);};
  const [versionRows,closed,previousOpen,posts,late,campaigns,collections,intervals]=await read([
    sql('SELECT * FROM app_revisions ORDER BY name'),sql('SELECT snapshot_hash,winners FROM earn_boards WHERE epoch=?',epoch),
    sql('SELECT 1 FROM earn_submissions s WHERE s.epoch=? AND NOT EXISTS(SELECT 1 FROM earn_boards b WHERE b.epoch=s.epoch) LIMIT 1',epoch-1),
    sql(`SELECT s.*,r.content_score,r.reviewed_ms,r.source_ref AS review_ref,r.reason,r.moderator,e.micro_usd AS entry_micro_usd
      FROM earn_submissions s JOIN earn_stake_reads e ON e.id=s.entry_read_id LEFT JOIN earn_reviews r ON r.submission_id=s.id
      WHERE s.epoch=? ORDER BY s.id LIMIT 101`,epoch),
    sql(`SELECT s.wallet,r.reviewed_ms,d.qualified FROM earn_reviews r JOIN earn_submissions s ON s.id=r.submission_id
      LEFT JOIN earn_decisions d ON d.submission_id=s.id WHERE r.reviewed_ms BETWEEN ? AND ? AND s.epoch<? AND r.content_score>0 LIMIT 101`,epoch*DAY_MS,cutoff,epoch),
    sql(`SELECT DISTINCT c.token_id AS tokenId,c.activation_ms AS activationMs FROM earn_fixture_campaigns c
      JOIN earn_submissions s ON s.token_id=c.token_id WHERE s.epoch=? ORDER BY c.token_id LIMIT 101`,epoch),
    sql('SELECT * FROM earn_known_collections ORDER BY collection_id LIMIT 101'),
    sql(`SELECT a.id AS actionId,a.label,a.verifier,c.effective_epoch AS startEpoch FROM earn_action_catalog a
      JOIN earn_action_changes c ON c.action_id=a.id AND c.effective_epoch=(SELECT MAX(v.effective_epoch)
      FROM earn_action_changes v WHERE v.action_id=a.id AND v.effective_epoch<=?) WHERE c.enabled=1 ORDER BY a.id LIMIT 101`,epoch),
  ]);
  if(closed[0])return {kind:'final',epoch,snapshotId:closed[0].snapshot_hash,winners:JSON.parse(closed[0].winners)};
  if(previousOpen.length)return pending('previous-board');
  if(![posts,late,campaigns,collections,intervals].every(bounded))return pending('board-input-bound');
  const wallets=[...new Set([...posts.map(p=>p.wallet),...late.map(p=>p.wallet)])];
  if(wallets.length>100)return pending('board-input-bound');
  const closingStake=Object.create(null),facts=Object.create(null),previousStreaks=Object.create(null);
  const walletStatements=wallet=>[
      sql(`SELECT CASE WHEN length(assets)<=262144 THEN assets ELSE NULL END AS assets,source_ref
        FROM earn_owner_snapshots WHERE epoch=? AND wallet=?`,epoch,wallet),
      sql('SELECT action_id AS actionId,verified_ms AS verifiedAtMs,source_ref AS sourceRef FROM earn_action_completions WHERE wallet=? AND verified_ms<=? ORDER BY action_id LIMIT 101',wallet,cutoff),
      sql(`SELECT e.token_id,c.token_days,c.source_ref,c.credited,c.flags FROM earn_position_enrollments e
        JOIN earn_fixture_campaigns m ON m.token_id=e.token_id LEFT JOIN earn_position_cutoffs c
        ON c.wallet=e.wallet AND c.token_id=e.token_id AND c.epoch=? WHERE e.wallet=? AND e.enrolled_ms<=?
        AND m.activation_ms<=? AND m.activation_ms>? ORDER BY e.token_id LIMIT 101`,epoch,wallet,cutoff,cutoff,cutoff-10*DAY_MS),
      sql(`SELECT o.token_id,o.receipt,o.as_of_ms,o.decision,r.id,r.micro_usd FROM price_observations o
        JOIN earn_fixture_campaigns c ON c.token_id=o.token_id LEFT JOIN earn_stake_reads r ON r.id=o.read_id
        WHERE o.wallet=? AND o.as_of_ms<=? AND ((c.activation_ms<=? AND c.activation_ms>?)
          OR EXISTS(SELECT 1 FROM earn_submissions s WHERE s.wallet=o.wallet AND s.token_id=o.token_id AND s.epoch=?))
        AND NOT EXISTS(SELECT 1 FROM price_observations n WHERE n.wallet=o.wallet AND n.token_id=o.token_id AND n.as_of_ms<=?
          AND (n.as_of_ms>o.as_of_ms OR (n.as_of_ms=o.as_of_ms AND n.revision>o.revision))) ORDER BY o.token_id LIMIT 101`,wallet,cutoff,cutoff,cutoff-10*DAY_MS,epoch,cutoff),
      sql('SELECT epoch,days,last_approval_ms AS lastApprovalMs FROM earn_streaks WHERE epoch=? AND wallet=?',epoch-1,wallet),
    ];
  for(let offset=0;offset<wallets.length;offset+=10) {
    const group=wallets.slice(offset,offset+10),batch=await read(group.flatMap(walletStatements));
    for(let index=0;index<group.length;index++) {
    const wallet=group[index],[owners,completions,positions,observations,streaks]=batch.slice(index*5,index*5+5);
    if(![completions,positions,observations].every(bounded)||owners[0]?.assets===null)return pending('board-input-bound');
    previousStreaks[wallet]=streaks[0]??null;
    const values=Object.fromEntries(observations.map(o=>[o.token_id,valuation(o,cutoff)]));
    let qualified=false;
    for(const post of posts.filter(p=>p.wallet===wallet)) {
      const obs=observations.find(o=>o.token_id===post.token_id);
      const read=post.content_score>0&&values[post.token_id]?.status==='verified'&&obs?.id?{id:obs.id,micro_usd:obs.micro_usd}:null;
      closingStake[post.id]=read;
      if(read&&BigInt(read.micro_usd)>=MIN_STAKE_MICRO_USD)qualified=true;
    }
    if(qualified) {
      const plan=componentPlan({epoch,cutoff,owner:owners[0],collections,positions,valuations:values,intervals,completions});
      if(plan.status==='ready') {
        const {sourceInput,...result}=plan;facts[wallet]={...result,sourceRef:await crypto.sha256(utf8(JSON.stringify(sourceInput)))};
      }else facts[wallet]=plan;
    }
  }
  }
  const input={epoch,cutoff,nowMs,sourceRef,posts,closingStake,facts,late,previousStreaks,campaigns};
  const bytes=utf8(canonicalJson(input));if(bytes.byteLength>256*1024)return pending('board-input-bound');
  const current=revisions((await read([sql('SELECT * FROM app_revisions ORDER BY name')]))[0]),captured=revisions(versionRows);
  if(canonicalJson(current)!==canonicalJson(captured))return {kind:'conflict',code:'revision_conflict'};
  return {kind:'loaded',input,versions:captured,inputDigest:await crypto.sha256(bytes),measurements:{inputBytes:bytes.byteLength,participants:wallets.length,posts:posts.length,readBatches}};
}
