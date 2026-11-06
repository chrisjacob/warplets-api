import {createAtomicReceipts} from '../storage/atomic-receipts.mjs';
import {sql,revisions,matchesExpectedRevisions} from '../storage/atomic-driver.mjs';
import {canonicalJson} from '../security/canonical.mjs';
import {createGovernancePlanning} from '../application/collection-governance.mjs';
import {CollectionPolicyError} from '../domain/collections/policy.mjs';
import {validBallotContext} from './validation.mjs';
import {prepareGovernanceOperatorCommand,PUBLISH_BALLOT,RECORD_DECISION} from './operator-service.mjs';
import {readGovernanceElectorates} from './operator-source.mjs';
const conflict=code=>({kind:'conflict',code}),pending=(reason,id)=>({kind:'pending',reason,dependencyIds:[id]});
const scopeSql="EXISTS(SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope=? AND enabled=1)";
export function createGovernanceOperatorRepository(driver,ports){
 const receipts=createAtomicReceipts(driver,ports),planning=createGovernancePlanning(ports),nowSql=driver.leaseNowSql??"CAST(unixepoch('subsec') * 1000 AS INTEGER)";
 async function command(value,kind){const c=structuredClone(value),expected=await prepareGovernanceOperatorCommand(kind,c,ports.crypto);if(c.operationKind!==kind||c.businessIdentity!==expected.businessIdentity||c.requestDigest!==expected.requestDigest)throw new TypeError('Invalid governance operator command.');return c;}
 async function capture(c,scope){
  const prior=await receipts.replay(c);if(prior)return {outcome:prior};
  const [rs,grants,ballots]=await receipts.read([sql('SELECT * FROM app_revisions ORDER BY name'),sql('SELECT enabled FROM app_operator_scopes WHERE operator=? AND scope=?',c.principal.id,scope),sql('SELECT * FROM genesis_ballots WHERE id=?',c.input.ballotId)]);
  const version=revisions(rs);if(!matchesExpectedRevisions(c.expectedRevisions,version))return {outcome:conflict('revision_conflict')};if(!grants[0]?.enabled)return {outcome:conflict('operator_scope_required')};return {version,ballot:ballots[0]};
 }
 return Object.freeze({
  async publishBallot(value){
   const c=await command(value,PUBLISH_BALLOT),captured=await capture(c,'governance-publication');if(captured.outcome)return captured.outcome;if(captured.ballot)return conflict('ballot_already_published');
   const b=c.input,loaded=await readGovernanceElectorates(receipts.read,[b.holdersListId,b.nextWhitelistListId,b.unionListId],ports.crypto);if(loaded.kind!=='ready')return loaded;
   const holders=loaded.lists.get(b.holdersListId).wallets,nextWhitelist=loaded.lists.get(b.nextWhitelistListId).wallets,union=loaded.lists.get(b.unionListId).wallets;
   const expectedUnion=[...new Set([...holders,...nextWhitelist])].sort();if(expectedUnion.length>10000)return conflict('electorate_bound');if(canonicalJson(expectedUnion)!==canonicalJson(union))return conflict('electorate_union_conflict');
   const source={sourceId:b.electorateSourceId,cutoffMs:b.cutoffMs,holders,nextWhitelist};if(await planning.electorateDigest(source)!==b.electorateDigest)return conflict('electorate_digest_conflict');
   const pure=await planning.publishBallot({...c,input:{ballotId:b.ballotId,opensMs:b.opensMs,previousTrancheOpeningMs:b.previousTrancheOpeningMs,electorateSourceId:b.electorateSourceId,electorateDigest:b.electorateDigest}}),plan=await planning.planPublication(pure,source);
   if(plan.electorate.manifest.id!==b.unionListId)return conflict('electorate_union_conflict');
   const result={...plan.result,sourceKind:b.sourceKind},input={...b,snapshotHash:result.snapshotHash,eligibleCount:result.eligibleCount,closesMs:result.closesAt};
   const listGates=[...loaded.lists.values()].map(({seal})=>({sql:'EXISTS(SELECT 1 FROM app_collection_list_seals WHERE id=? AND closure_digest=? AND member_count=?)',values:[seal.id,seal.closureDigest,seal.count]}));
   return receipts.execute(c,{businessKey:c.businessIdentity,input,result,resultRef:b.ballotId,version:captured.version,
    authoritySql:`${scopeSql} AND NOT EXISTS(SELECT 1 FROM genesis_ballots WHERE id=?) AND ${listGates.map(g=>g.sql).join(' AND ')}`,
    authorityValues:[c.principal.id,'governance-publication',b.ballotId,...listGates.flatMap(g=>g.values)],
    child:(gate,v)=>[
     sql(`INSERT INTO genesis_ballots(id,opens_ms,closes_ms,tranche_open_ms,snapshot_hash,eligible_count) SELECT ?,?,?,?,?,? WHERE ${gate}`,b.ballotId,b.opensMs,result.closesAt,b.previousTrancheOpeningMs,result.snapshotHash,result.eligibleCount,...v),
     sql(`INSERT INTO app_governance_publications(ballot_id,source_id,cutoff_ms,source_kind,holders_list_id,next_whitelist_list_id,union_list_id,source_digest,operation_id) SELECT ?,?,?,?,?,?,?,?,operation_id FROM app_command_receipts WHERE operation_id=? AND claim_nonce=? AND state='staging' AND ${gate}`,b.ballotId,b.electorateSourceId,b.cutoffMs,b.sourceKind,b.holdersListId,b.nextWhitelistListId,b.unionListId,b.electorateDigest,...v,...v),
     sql(`INSERT INTO genesis_voters(ballot_id,wallet) SELECT ?,members.value FROM app_collection_list_seals s JOIN json_each(s.page_ids_json) pages JOIN app_collection_eligibility_pages p ON p.record_id=pages.value JOIN json_each(p.entries_json) members WHERE s.id=? AND ${gate}`,b.ballotId,b.unionListId,...v),
    ]});
  },
  async recordDecision(value){
   const c=await command(value,RECORD_DECISION),captured=await capture(c,'governance-decision');if(captured.outcome)return captured.outcome;const row=captured.ballot;if(!row)return conflict('ballot_not_found');if(!validBallotContext(row))return pending('invalid-ballot-context',row.id);
   const [decisions,coverage,claimed]=await receipts.read([sql('SELECT ballot_id AS ballotId,choice,decided_ms AS decidedMs,notice_ms AS noticeMs,earliest_ms AS earliestMs,rationale FROM genesis_decisions WHERE ballot_id=?',row.id),sql('SELECT COUNT(*) AS n FROM genesis_voters WHERE ballot_id=?',row.id),sql('SELECT operation_id FROM app_command_receipts WHERE operation_kind=? AND business_key=?',RECORD_DECISION,c.businessIdentity)]);
   if(claimed.length)return conflict('decision_already_recorded');
   if(coverage[0].n!==row.eligible_count)return pending('electorate-incomplete',row.id);
   let plan;try{plan=planning.planDecision(c,{ballot:{id:row.id,opensAt:row.opens_ms,closesAt:row.closes_ms,currentTrancheOpenedAt:row.tranche_open_ms,snapshotHash:row.snapshot_hash},priorDecision:decisions[0]??null});}
   catch(error){if(error instanceof CollectionPolicyError)return conflict(error.code);if(error instanceof TypeError)return conflict(decisions.length?'decision_conflict':'invalid_decision');throw error;}
   const d=plan.decision,old=plan.replayed,input={...c.input,earliestMs:d.earliestMs,ballotSnapshotHash:row.snapshot_hash,adoptedLegacy:old};
   return receipts.execute(c,{businessKey:c.businessIdentity,input,result:d,resultRef:row.id,version:captured.version,
    authoritySql:`${scopeSql} AND ${nowSql}>=? AND EXISTS(SELECT 1 FROM genesis_ballots b WHERE id=? AND snapshot_hash=? AND opens_ms=? AND closes_ms=? AND tranche_open_ms=? AND eligible_count=(SELECT COUNT(*) FROM genesis_voters WHERE ballot_id=b.id)) AND ${old?'EXISTS(SELECT 1 FROM genesis_decisions WHERE ballot_id=? AND choice=? AND decided_ms=? AND notice_ms=? AND earliest_ms=? AND rationale=?)':'NOT EXISTS(SELECT 1 FROM genesis_decisions WHERE ballot_id=?)'}`,
    authorityValues:[c.principal.id,'governance-decision',d.decidedMs,row.id,row.snapshot_hash,row.opens_ms,row.closes_ms,row.tranche_open_ms,...(old?[row.id,d.choice,d.decidedMs,d.noticeMs,d.earliestMs,d.rationale]:[row.id])],
    child:(gate,v)=>old?[]:[sql(`INSERT INTO genesis_decisions(ballot_id,choice,decided_ms,notice_ms,earliest_ms,rationale) SELECT ?,?,?,?,?,? WHERE ${gate}`,row.id,d.choice,d.decidedMs,d.noticeMs,d.earliestMs,d.rationale,...v)],
   });
  },
 });
}
