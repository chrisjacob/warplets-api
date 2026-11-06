import {createGovernancePlanning} from './collection-governance.mjs';
import {CollectionPolicyError} from '../domain/collections/policy.mjs';
import {decode58} from '../server/base58.mjs';
export class GovernanceError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const id=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
function unwrap(result){
 if(result.kind==='pending')throw new GovernanceError(503,result.reason.replaceAll('-','_'),'Governance evidence is temporarily unavailable.');
 if(result.kind==='conflict')throw new GovernanceError(result.code==='ballot_not_found'?404:409,result.code,result.code==='ballot_not_found'?'Unknown ballot.':'Vote could not be recorded.');
 return result.value;
}
export function createGovernanceService({repository,reads,crypto,clock}){
 const planning=createGovernancePlanning({crypto});
 return Object.freeze({
  async listBallots(){return unwrap(await reads.listBallots({nowMs:clock.nowMs()}));},
  async readBallot(ballotId){if(!id(ballotId))throw new GovernanceError(400,'invalid_ballot','Invalid ballot identity.');return unwrap(await reads.readBallot({id:ballotId,nowMs:clock.nowMs()}));},
  async castVote(principalInput,input){
   const principal=structuredClone(principalInput),body=structuredClone(input);
   if(principal?.kind!=='wallet')throw new GovernanceError(401,'authentication_required','Connect your wallet.');
   try{decode58(principal.wallet,32);}catch{throw new GovernanceError(401,'authentication_required','Connect your wallet.');}
   if(!id(body?.ballotId)||!['ASAP','7','14','30'].includes(body?.choice))throw new GovernanceError(422,'invalid_choice','Choose a published ballot option.');
   try{
    for(let attempt=0;attempt<2;attempt++){
     const command=await planning.castVote({principal,input:body,requestKey:body.ballotId,expectedRevisions:{},nowMs:clock.nowMs()});
     const result=await repository.castVote(command);
     if(result.kind==='conflict'&&result.code==='revision_conflict')continue;
     const value=unwrap(result);return {...value,replayed:result.kind==='replayed'||value.replayed};
    }
    throw new GovernanceError(503,'governance_concurrent_change','The ballot changed during admission. Retry the same choice.');
   }catch(error){
    if(error instanceof CollectionPolicyError)throw new GovernanceError(error.code==='voter_ineligible'?403:error.code==='invalid_choice'?422:409,error.code,'Vote could not be recorded.');
    throw error;
   }
  },
 });
}
