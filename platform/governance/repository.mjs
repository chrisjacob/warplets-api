import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions,matchesExpectedRevisions} from '../storage/atomic-driver.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {createGovernancePlanning} from '../application/collection-governance.mjs';
import {validBallotContext} from './validation.mjs';
const clone=value=>JSON.parse(canonicalJson(value)),conflict=code=>({kind:'conflict',code});
export function createGovernanceRepository(driver,ports){
 const receipts=createAtomicReceipts(driver,ports),planning=createGovernancePlanning(ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec') * 1000 AS INTEGER)";
 return Object.freeze({async castVote(value){
  const c=clone(value);
  const expected=await planning.castVote({principal:c.principal,input:c.input,requestKey:c.requestKey,expectedRevisions:c.expectedRevisions,nowMs:c.nowMs});
  if(c.operationKind!==expected.operationKind||c.businessIdentity!==expected.businessIdentity||c.requestDigest!==expected.requestDigest||c.requestKey!==c.input.ballotId)throw new TypeError('Invalid guarded vote command.');
  const accepted=await receipts.replay(c);if(accepted)return accepted;
  const [versionRows,ballots,members,prior,counts]=await receipts.read([
   sql('SELECT * FROM app_revisions ORDER BY name'),sql('SELECT * FROM genesis_ballots WHERE id=?',c.input.ballotId),
   sql('SELECT wallet FROM genesis_voters WHERE ballot_id=? AND wallet=?',c.input.ballotId,c.principal.wallet),
   sql('SELECT ballot_id AS ballotId,wallet,choice,voted_ms AS votedMs FROM genesis_votes WHERE ballot_id=? AND wallet=?',c.input.ballotId,c.principal.wallet),
   sql('SELECT COUNT(*) AS n FROM genesis_voters WHERE ballot_id=?',c.input.ballotId),
  ]);
  const version=revisions(versionRows);if(!matchesExpectedRevisions(c.expectedRevisions,version))return conflict('revision_conflict');
  const row=ballots[0];if(!row)return conflict('ballot_not_found');
  if(!validBallotContext(row))return {kind:'pending',reason:'invalid-ballot-context',dependencyIds:[row.id]};
  if(counts[0].n!==row.eligible_count)return {kind:'pending',reason:'electorate-incomplete',dependencyIds:[row.id]};
  const ballot={id:row.id,opensAt:row.opens_ms,closesAt:row.closes_ms,currentTrancheOpenedAt:row.tranche_open_ms,snapshotHash:row.snapshot_hash};
  const plan=planning.planVote(c,{ballot,membership:{wallet:c.principal.wallet,eligible:members.length===1,snapshotHash:row.snapshot_hash},priorVote:prior[0]??null});
  const input={ballotId:row.id,wallet:c.principal.wallet,choice:plan.vote.choice,votedMs:plan.vote.votedMs,ballotSnapshotHash:row.snapshot_hash,adoptedLegacy:plan.replayed};
  const old=plan.replayed;
  return receipts.execute(c,{businessKey:c.businessIdentity,input,result:{choice:plan.vote.choice,replayed:old},resultRef:c.businessIdentity,version,
   authoritySql:`EXISTS(SELECT 1 FROM genesis_ballots b JOIN genesis_voters m ON m.ballot_id=b.id AND m.wallet=?
    WHERE b.id=? AND b.snapshot_hash=? AND b.opens_ms=? AND b.closes_ms=? AND b.tranche_open_ms=? AND b.eligible_count=?
     AND b.eligible_count=(SELECT COUNT(*) FROM genesis_voters e WHERE e.ballot_id=b.id)
     AND ${old?'EXISTS(SELECT 1 FROM genesis_votes v WHERE v.ballot_id=b.id AND v.wallet=m.wallet AND v.choice=? AND v.voted_ms=?)':`NOT EXISTS(SELECT 1 FROM genesis_votes v WHERE v.ballot_id=b.id AND v.wallet=m.wallet) AND b.opens_ms<=${nowSql} AND b.closes_ms>${nowSql}`})`,
   authorityValues:[c.principal.wallet,row.id,row.snapshot_hash,row.opens_ms,row.closes_ms,row.tranche_open_ms,row.eligible_count,...(old?[plan.vote.choice,plan.vote.votedMs]:[])],
   child:(gate,values)=>old?[]:[sql(`INSERT INTO genesis_votes(ballot_id,wallet,choice,voted_ms) SELECT ?,?,?,? WHERE ${gate}`,row.id,c.principal.wallet,plan.vote.choice,plan.vote.votedMs,...values)],
  });
 }});
}
