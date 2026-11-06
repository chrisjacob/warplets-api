import {canonicalJson,utf8} from '../security/canonical.mjs';
import {roundTime} from './request-plan.mjs';
import {traitFields,validateTraitChoices,uniformCandidate,uniformPreimage,beaconSeedPreimage,beaconProofPreimage,pickTrait} from './draw-protocol.mjs';
const clone=v=>JSON.parse(canonicalJson(v));
export async function uniformDraw(seed,label,size,crypto){
 for(let index=0;index<256;index++){const value=uniformCandidate(await crypto.sha256(utf8(canonicalJson(uniformPreimage(seed,label,index)))),size);if(value!==null)return value;}
 throw Error('Random sample exhausted; retain the same commitment.');
}
export async function materializeProgressionDraw(value,crypto){
 const {operation:op,request,randomness,traitChoices}=clone(value);
 if(!['upgrade','visual'].includes(op.kind)||!/^[a-f0-9]{64}$/.test(request.context_digest)||!/^[a-f0-9]{64}$/.test(randomness)||!Number.isSafeInteger(request.target_round)||request.target_round<1)throw Error('Invalid progression draw binding.');
 const hash=v=>crypto.sha256(utf8(canonicalJson(v))),seed=await hash(beaconSeedPreimage(request.context_digest,randomness)),output={operationId:op.id,commitment:op.commitment,proofId:await hash(beaconProofPreimage(request.target_round,seed)),at:roundTime(request.target_round),finalized:true};
 if(op.kind==='upgrade')output.ticket=await uniformDraw(seed,'upgrade-level',1000,crypto);
 else{const traits=validateTraitChoices(traitChoices);output.traits={};for(const key of traitFields){const choices=traits[key],pick=await uniformDraw(seed,key,choices.reduce((sum,c)=>sum+c.weight,0),crypto);output.traits[key]=pickTrait(choices,pick);}}
 return output;
}
