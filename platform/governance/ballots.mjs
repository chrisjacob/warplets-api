import {createHash} from 'node:crypto';
import {openBallot,earliestTrancheOpening,BALLOT_CHOICES} from '../domain/collections/ballot.mjs';
import {currentSession,consumeQuota} from '../server/auth.mjs';
import {decode58} from '../server/base58.mjs';
import {transaction} from '../storage/database.mjs';
import {createNodeGovernanceService} from '../application/node-context.mjs';
import {handleInteractiveGovernance} from './interactive-http.mjs';

const date=n=>new Date(n).toISOString();
const rowFor=(db,id)=>db.prepare('SELECT * FROM genesis_ballots WHERE id=?').get(id);
const domain=row=>({id:row.id,opensAt:row.opens_ms,closesAt:row.closes_ms,currentTrancheOpenedAt:row.tranche_open_ms});
export function seedBallot(db,input) {
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id))throw Error('Invalid ballot ID.');
  const ballot=openBallot(input);
  if(ballot.voters.length>10000)throw Error('Pilot electorate exceeds 10,000 wallets.');
  for(const wallet of ballot.voters)decode58(wallet,32);
  const digest=createHash('sha256').update(JSON.stringify([ballot.id,ballot.opensAt,ballot.currentTrancheOpenedAt,ballot.voters])).digest('hex');
  return transaction(db,()=>{
    const old=rowFor(db,ballot.id);
    if(old) {
      if(old.snapshot_hash!==digest)throw Error('Ballot snapshot already frozen.');
      return digest;
    }
    db.prepare('INSERT INTO genesis_ballots VALUES(?,?,?,?,?,?)').run(ballot.id,ballot.opensAt,ballot.closesAt,
      ballot.currentTrancheOpenedAt,digest,ballot.voters.length);
    const insert=db.prepare('INSERT INTO genesis_voters VALUES(?,?)');
    for(const wallet of ballot.voters)insert.run(ballot.id,wallet);
    return digest;
  });
}
export function recordDecision(db,{id,choice,decidedAt,noticeAt,rationale},now=Date.now()) {
  if(typeof rationale!=='string'||!rationale.trim()||rationale.length>1000)throw Error('A short public rationale is required.');
  if(decidedAt>now||noticeAt>decidedAt)throw Error('Invalid decision or notice time.');
  return transaction(db,()=>{
    const row=rowFor(db,id);if(!row)throw Error('Unknown ballot.');
    const earliest=earliestTrancheOpening({ballot:domain(row),founderChoice:choice,decidedAt,noticeAt});
    const prior=db.prepare('SELECT * FROM genesis_decisions WHERE ballot_id=?').get(id);
    if(prior){
      if(prior.choice!==choice||prior.decided_ms!==decidedAt||prior.notice_ms!==noticeAt||prior.rationale!==rationale)
        throw Error('Final decision already recorded.');
    }else db.prepare('INSERT INTO genesis_decisions VALUES(?,?,?,?,?,?)').run(id,choice,decidedAt,noticeAt,earliest,rationale);
    return {id,choice,rationale,decidedAt:date(decidedAt),earliestOpening:date(earliest)};
  });
}
export async function handleBallots(db,request,peer,now) {
  const service=createNodeGovernanceService(db,{clock:{nowMs:()=>now}});
  return handleInteractiveGovernance(request,{service,peer,
    authenticate:async req=>{const session=currentSession(db,req,now);return session?{kind:'wallet',wallet:session.wallet}:null;},
    consumeQuota:async(bucket,limit)=>consumeQuota(db,bucket,now,limit)});
}
export const ballotPaths={
  '/genesis/ballots':{get:{operationId:'listGenesisBallots',responses:{200:{description:'Recent local advisory ballots'}}}},
  '/genesis/ballots/{id}':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string'}}],get:{operationId:'getGenesisBallot',responses:{200:{description:'Turnout and final decision when available'}}}},
  '/genesis/ballots/{id}/votes':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string'}}],post:{operationId:'castGenesisVote',
    requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['choice'],properties:{choice:{type:'string',enum:BALLOT_CHOICES}}}}}},
    responses:{201:{description:'Recorded vote'},200:{description:'Original vote receipt on replay'},409:{description:'Closed ballot or conflicting vote'}}}}
};
