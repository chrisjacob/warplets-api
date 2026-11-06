import {sql,revisions} from '../storage/atomic-driver.mjs';
import {BALLOT_CHOICES} from '../domain/collections/ballot.mjs';
import {checkTimestamp} from '../domain/collections/policy.mjs';
import {validBallotContext} from './validation.mjs';
const iso=ms=>new Date(ms).toISOString();
export function createGovernanceReadModel(driver){
 async function read(statements){return (await driver.batch(statements)).map(result=>result.rows);}
 async function load(id,nowMs){
  checkTimestamp(nowMs);
  for(let attempt=0;attempt<2;attempt++){
   const [before,ballots]=await read([sql('SELECT * FROM app_revisions ORDER BY name'),id===null?sql('SELECT * FROM genesis_ballots ORDER BY opens_ms DESC,id LIMIT 10'):sql('SELECT * FROM genesis_ballots WHERE id=?',id)]);
   if(id!==null&&!ballots.length)return {kind:'conflict',code:'ballot_not_found'};
   if(ballots.some(row=>!validBallotContext(row)))return {kind:'pending',reason:'invalid-ballot-context',dependencyIds:ballots.filter(row=>!validBallotContext(row)).map(row=>row.id)};
   const ids=JSON.stringify(ballots.map(row=>row.id));
   const [tallies,decisions,coverage,after]=await read([
    sql('SELECT ballot_id,choice,COUNT(*) AS n FROM genesis_votes WHERE ballot_id IN (SELECT value FROM json_each(?)) GROUP BY ballot_id,choice',ids),
    sql('SELECT * FROM genesis_decisions WHERE ballot_id IN (SELECT value FROM json_each(?))',ids),
    sql('SELECT ballot_id,COUNT(*) AS n FROM genesis_voters WHERE ballot_id IN (SELECT value FROM json_each(?)) GROUP BY ballot_id',ids),
    sql('SELECT * FROM app_revisions ORDER BY name'),
   ]);
   if(revisions(before).source!==revisions(after).source)continue;
   const electorate=new Map(coverage.map(row=>[row.ballot_id,row.n]));
   if(ballots.some(row=>(electorate.get(row.id)??0)!==row.eligible_count))return {kind:'pending',reason:'electorate-incomplete',dependencyIds:ballots.filter(row=>(electorate.get(row.id)??0)!==row.eligible_count).map(row=>row.id)};
   const items=ballots.map(row=>{
    const closed=nowMs>=row.closes_ms,counts=closed?Object.fromEntries(BALLOT_CHOICES.map(choice=>[choice,0])):null;
    let votesCast=0;for(const tally of tallies.filter(tally=>tally.ballot_id===row.id)){votesCast+=tally.n;if(counts)counts[tally.choice]=tally.n;}
    const decision=decisions.find(decision=>decision.ballot_id===row.id);
    return {id:row.id,source:'local-fixture',status:closed?'closed':nowMs<row.opens_ms?'scheduled':'open',opensAt:iso(row.opens_ms),closesAt:iso(row.closes_ms),choices:BALLOT_CHOICES,eligibleWallets:row.eligible_count,votesCast,counts,
     decision:decision?{choice:decision.choice,rationale:decision.rationale,earliestOpening:iso(decision.earliest_ms)}:null};
   });
   return {kind:'ready',value:id===null?{items,nextCursor:null,asOf:iso(nowMs)}:items[0]};
  }
  return {kind:'pending',reason:'governance-read-changed',dependencyIds:[]};
 }
 return Object.freeze({listBallots:({nowMs})=>load(null,nowMs),readBallot:({id,nowMs})=>load(id,nowMs)});
}
