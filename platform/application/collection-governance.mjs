import {openBallot,castVote,earliestTrancheOpening,BALLOT_CHOICES,NOTICE_MS} from '../domain/collections/ballot.mjs';
import {CollectionPolicyError,checkTimestamp} from '../domain/collections/policy.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {decode58} from '../server/base58.mjs';
import {createCollectionStateCodec} from '../collect/state-codec.mjs';
const assert=(condition,message)=>{if(!condition)throw new TypeError(message);};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const ballotId=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const fields=(body,keys)=>assert(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===keys.length&&keys.every(key=>Object.hasOwn(body,key)),'Unexpected governance input fields.');
function validateBody(kind,body){
 if(kind==='governance.publish-ballot.v1'){
  fields(body,['ballotId','opensMs','previousTrancheOpeningMs','electorateSourceId','electorateDigest']);
  checkTimestamp(body.opensMs);checkTimestamp(body.previousTrancheOpeningMs);assert(id(body.electorateSourceId)&&digest(body.electorateDigest),'Invalid electorate source identity.');
 }else if(kind==='governance.cast-vote.v1'){
  fields(body,['ballotId','choice']);assert(BALLOT_CHOICES.includes(body.choice),'Invalid ballot choice.');
 }else{
  fields(body,['ballotId','choice','decidedMs','noticeMs','rationale']);assert(BALLOT_CHOICES.includes(body.choice),'Invalid founder choice.');
  checkTimestamp(body.decidedMs);checkTimestamp(body.noticeMs);assert(typeof body.rationale==='string'&&body.rationale.trim().length>0&&body.rationale.length<=1000,'Provide a bounded founder rationale.');
 }
 assert(ballotId(body.ballotId),'Invalid ballot identity.');
}
function header(value){
 assert(value&&ballotId(value.id)&&digest(value.snapshotHash),'Invalid frozen ballot identity.');checkTimestamp(value.opensAt);checkTimestamp(value.closesAt);checkTimestamp(value.currentTrancheOpenedAt);
 assert(value.closesAt===value.opensAt+NOTICE_MS&&value.opensAt>=value.currentTrancheOpenedAt,'Invalid frozen ballot timing.');
 return value;
}
/** Named builders/plans only. They do not authorize operator scope, publish a
 * source, issue a receipt, enforce storage races or expose an HTTP endpoint. */
export function createGovernancePlanning({crypto}){
 const codec=createCollectionStateCodec({crypto});
 async function command(operationKind,args){
  const value=structuredClone(args),expected=operationKind==='governance.cast-vote.v1'?'wallet':'operator';
  assert(value.principal?.kind===expected,'Wrong governance principal kind.');
  if(expected==='wallet')decode58(value.principal.wallet,32);else assert(id(value.principal.id),'Invalid operator identity.');
  assert(id(value.requestKey),'Invalid request key.');checkTimestamp(value.nowMs);validateBody(operationKind,value.input);
  assert(value.expectedRevisions&&Object.entries(value.expectedRevisions).every(([key,n])=>['earn','source','control'].includes(key)&&typeof n==='string'&&/^(0|[1-9]\d*)$/.test(n)),'Invalid expected revisions.');
  const businessIdentity=canonicalJson(operationKind==='governance.cast-vote.v1'?[value.input.ballotId,value.principal.wallet]:[value.input.ballotId]);
  const requestDigest=await crypto.sha256(utf8(canonicalJson([operationKind,value.principal,value.input])));
  return freeze({...value,operationKind,businessIdentity,requestDigest});
 }
 async function electorateDigest(input){
  const source=structuredClone(input);assert(id(source.sourceId)&&Array.isArray(source.holders)&&source.holders.length<=10000&&Array.isArray(source.nextWhitelist)&&source.nextWhitelist.length<=10000,'Invalid bounded electorate source.');
  checkTimestamp(source.cutoffMs);for(const owner of [...source.holders,...source.nextWhitelist])decode58(owner,32);
  return crypto.sha256(utf8(canonicalJson(['collection-electorate-source-v1',source.sourceId,source.cutoffMs,source.holders,source.nextWhitelist])));
 }
 async function planPublication(commandInput,sourceInput){
  const c=structuredClone(commandInput),source=structuredClone(sourceInput);assert(c.operationKind==='governance.publish-ballot.v1'&&c.principal.kind==='operator','Expected ballot publication command.');validateBody(c.operationKind,c.input);
  assert(source.sourceId===c.input.electorateSourceId&&source.cutoffMs===c.input.opensMs&&await electorateDigest(source)===c.input.electorateDigest,'Frozen electorate source mismatch.');
  const ballot=openBallot({id:c.input.ballotId,opensAt:c.input.opensMs,currentTrancheOpenedAt:c.input.previousTrancheOpeningMs,holders:source.holders,nextWhitelist:source.nextWhitelist});
  assert(ballot.voters.length<=10000,'Pilot electorate exceeds 10000 distinct wallets.');
  const snapshotHash=await crypto.sha256(utf8(JSON.stringify([ballot.id,ballot.opensAt,ballot.currentTrancheOpenedAt,ballot.voters])));
  const electorate=await codec.encodeWalletList(ballot.voters);
  const result=freeze({ballotId:ballot.id,snapshotHash,eligibleCount:ballot.voters.length,opensAt:ballot.opensAt,closesAt:ballot.closesAt,currentTrancheOpenedAt:ballot.currentTrancheOpenedAt,electorateManifestId:electorate.manifest.id,sourceId:source.sourceId,sourceDigest:c.input.electorateDigest,executable:false});
  return Object.freeze({status:'ready',result,electorate});
 }
 function planVote(commandInput,factsInput){
  const c=structuredClone(commandInput),facts=structuredClone(factsInput);assert(c.operationKind==='governance.cast-vote.v1'&&c.principal.kind==='wallet','Expected wallet vote command.');validateBody(c.operationKind,c.input);
  const ballot=header(facts.ballot);assert(c.input.ballotId===ballot.id,'Ballot identity mismatch.');
  const previous=facts.priorVote;
  if(previous){
   assert(previous.wallet===c.principal.wallet&&previous.ballotId===ballot.id,'Prior vote identity mismatch.');
   if(previous.choice!==c.input.choice)throw new CollectionPolicyError('wallet_already_voted');
   return freeze({status:'ready',replayed:true,vote:previous,voteCountDelta:0});
  }
  assert(facts.membership.wallet===c.principal.wallet&&facts.membership.snapshotHash===ballot.snapshotHash&&typeof facts.membership.eligible==='boolean','Electorate membership identity mismatch.');
  // castVote only observes this wallet's membership/prior vote, choice and time.
  // Other wallets' votes cannot alter these predicates; uniqueness is a SQL gate.
  castVote({...ballot,voters:facts.membership.eligible?[c.principal.wallet]:[],votes:[]},{wallet:c.principal.wallet,choice:c.input.choice,at:c.nowMs});
  return freeze({status:'ready',replayed:false,vote:{ballotId:ballot.id,wallet:c.principal.wallet,choice:c.input.choice,votedMs:c.nowMs},voteCountDelta:1});
 }
 function planDecision(commandInput,factsInput){
  const c=structuredClone(commandInput),facts=structuredClone(factsInput);assert(c.operationKind==='governance.record-decision.v1'&&c.principal.kind==='operator','Expected founder decision command.');validateBody(c.operationKind,c.input);
  const ballot=header(facts.ballot);assert(c.input.ballotId===ballot.id,'Ballot identity mismatch.');
  assert(c.input.decidedMs<=c.nowMs&&c.input.noticeMs<=c.input.decidedMs,'Invalid decision or notice time.');
  const earliestMs=earliestTrancheOpening({ballot,founderChoice:c.input.choice,decidedAt:c.input.decidedMs,noticeAt:c.input.noticeMs});
  const decision={ballotId:ballot.id,choice:c.input.choice,decidedMs:c.input.decidedMs,noticeMs:c.input.noticeMs,earliestMs,rationale:c.input.rationale};
  if(facts.priorDecision)assert(canonicalJson(facts.priorDecision)===canonicalJson(decision),'Final decision already recorded.');
  return freeze({status:'ready',replayed:!!facts.priorDecision,decision});
 }
 return Object.freeze({publishBallot:args=>command('governance.publish-ballot.v1',args),castVote:args=>command('governance.cast-vote.v1',args),recordDecision:args=>command('governance.record-decision.v1',args),electorateDigest,planPublication,planVote,planDecision});
}
