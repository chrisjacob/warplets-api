import {createHash} from 'node:crypto';
import {openBallot,castVote,earliestTrancheOpening,BALLOT_CHOICES} from '../domain/collections/ballot.mjs';
import {CollectionPolicyError} from '../domain/collections/policy.mjs';
import {currentSession,consumeQuota} from '../server/auth.mjs';
import {decode58} from '../server/base58.mjs';
import {transaction} from '../storage/database.mjs';
import {json,failure} from '../server/api.mjs';

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
function summary(db,row,now) {
  const closed=now>=row.closes_ms;
  const count=db.prepare('SELECT COUNT(*) AS total FROM genesis_votes WHERE ballot_id=?').get(row.id).total;
  const counts=closed?Object.fromEntries(BALLOT_CHOICES.map(c=>[c,0])):null;
  if(closed)for(const entry of db.prepare('SELECT choice,COUNT(*) AS n FROM genesis_votes WHERE ballot_id=? GROUP BY choice').all(row.id))counts[entry.choice]=entry.n;
  const d=db.prepare('SELECT * FROM genesis_decisions WHERE ballot_id=?').get(row.id);
  return {id:row.id,source:'local-fixture',status:closed?'closed':now<row.opens_ms?'scheduled':'open',opensAt:date(row.opens_ms),
    closesAt:date(row.closes_ms),choices:BALLOT_CHOICES,eligibleWallets:row.eligible_count,votesCast:count,counts,
    decision:d?{choice:d.choice,rationale:d.rationale,earliestOpening:date(d.earliest_ms)}:null};
}
export async function handleBallots(db,request,peer,now) {
  const {pathname,origin}=new URL(request.url),base='/api/v1/genesis/ballots';
  if(pathname!==base&&!pathname.startsWith(base+'/'))return null;
  if(pathname===base&&request.method==='GET') {
    const rows=db.prepare('SELECT * FROM genesis_ballots ORDER BY opens_ms DESC,id LIMIT 10').all();
    return json({items:rows.map(row=>summary(db,row,now)),nextCursor:null,asOf:date(now)});
  }
  const match=pathname.match(/^\/api\/v1\/genesis\/ballots\/([a-z0-9-]{1,64})(\/votes)?$/);
  if(!match)return failure(404,'not_found','Unknown ballot resource.');
  const row=rowFor(db,match[1]);if(!row)return failure(404,'ballot_not_found','Unknown ballot.');
  if(!match[2]&&request.method==='GET')return json(summary(db,row,now));
  if(!match[2]||request.method!=='POST')return failure(405,'method_not_allowed','Unsupported method.',{allow:match[2]?'POST':'GET'});
  if(request.headers.get('origin')!==origin)return failure(403,'invalid_origin','Use the local origin.');
  const session=currentSession(db,request,now);if(!session)return failure(401,'authentication_required','Connect your wallet.');
  const quota=consumeQuota(db,'votes:'+session.wallet,now,12);if(quota)return quota;
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return failure(415,'unsupported_media_type','Use application/json.');
  let choice;try{({choice}=await request.json());}catch{return failure(400,'invalid_input','Expected a ballot choice.');}
  try {
    const result=transaction(db,()=>{
      const existing=db.prepare('SELECT choice FROM genesis_votes WHERE ballot_id=? AND wallet=?').get(row.id,session.wallet);
      if(existing){
        if(existing.choice!==choice)throw new CollectionPolicyError('wallet_already_voted');
        return {choice,replayed:true};
      }
      const eligible=db.prepare('SELECT 1 FROM genesis_voters WHERE ballot_id=? AND wallet=?').get(row.id,session.wallet);
      castVote({...domain(row),voters:eligible?[session.wallet]:[],votes:[]},{wallet:session.wallet,choice,at:now});
      db.prepare('INSERT INTO genesis_votes VALUES(?,?,?,?)').run(row.id,session.wallet,choice,now);
      return {choice,replayed:false};
    });
    return json(result,result.replayed?200:201);
  } catch(err) {
    if(!(err instanceof CollectionPolicyError))throw err;
    return failure(err.code==='voter_ineligible'?403:err.code==='invalid_choice'?422:409,err.code,'Vote could not be recorded.');
  }
}
export const ballotPaths={
  '/genesis/ballots':{get:{operationId:'listGenesisBallots',responses:{200:{description:'Recent local advisory ballots'}}}},
  '/genesis/ballots/{id}':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string'}}],get:{operationId:'getGenesisBallot',responses:{200:{description:'Turnout and final decision when available'}}}},
  '/genesis/ballots/{id}/votes':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string'}}],post:{operationId:'castGenesisVote',
    requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['choice'],properties:{choice:{type:'string',enum:BALLOT_CHOICES}}}}}},
    responses:{201:{description:'Recorded vote'},200:{description:'Original vote receipt on replay'},409:{description:'Closed ballot or conflicting vote'}}}}
};
