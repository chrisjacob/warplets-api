// Synthetic retained assignment/reveal facts, with the genuine recorded beacon
// proof. This helper grants no repository or public disclosure authority.
import {readFileSync} from 'node:fs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {drawRequestPreimage,roundTime,leadMs} from '../randomness/request-plan.mjs';
import {beaconSeedPreimage,beaconProofPreimage,traitFields,pickTrait} from '../randomness/draw-protocol.mjs';
import {uniformDraw,materializeProgressionDraw} from '../randomness/portable-draw.mjs';
import {LEVEL_QUOTAS,drawLevel} from '../domain/collections/policy.mjs';
export const recordedFairnessProof=Object.freeze(JSON.parse(readFileSync(new URL('../beacon/fixtures/round-30000000.json',import.meta.url))));
const proof=recordedFairnessProof,crypto=createNodeCrypto(),hash=v=>crypto.sha256(utf8(canonicalJson(v)));
export async function fairnessProjectionFixture(kind='mint'){
 const op={id:'synthetic-private-operation',kind,inventoryId:'synthetic-inventory',owner:'11111111111111111111111111111111',rawCommitment:'private-opaque-commitment-never-before-reveal',createdMs:roundTime(proof.round)-leadMs,settledMs:roundTime(proof.round)+1000,proofId:null},policy={policyHash:'a'.repeat(64),registeredMs:op.createdMs-1000,traitChoices:Object.fromEntries(traitFields.map(k=>[k,[{name:'Synthetic '+k+' one',weight:2},{name:'Synthetic '+k+' two',weight:1}]]))};
 const derived=drawRequestPreimage({policy_hash:policy.policyHash,registered_ms:policy.registeredMs},{opId:op.id,kind,inventoryId:op.inventoryId,owner:op.owner,commitment:op.rawCommitment,now:op.createdMs}),request={targetRound:derived.targetRound,contextDigest:await hash(derived.preimage)},seed=await hash(beaconSeedPreimage(request.contextDigest,proof.randomness));let result,level=null;
 if(kind==='mint'){const traits={};for(const k of traitFields)traits[k]=pickTrait(policy.traitChoices[k],await uniformDraw(seed,k,3,crypto));const ticket=await uniformDraw(seed,'initial-level',1000,crypto);level=drawLevel(LEVEL_QUOTAS,ticket);result={operationId:op.id,commitment:op.rawCommitment,proofId:await hash(beaconProofPreimage(proof.round,seed)),at:roundTime(proof.round),finalized:true,traits,ticket,assetId:'synthetic-assigned-asset'};}
 else result=await materializeProgressionDraw({operation:{id:op.id,kind,commitment:op.rawCommitment},request:{target_round:request.targetRound,context_digest:request.contextDigest},randomness:proof.randomness,traitChoices:policy.traitChoices},crypto);
 op.proofId=result.proofId;return {operation:op,policy,request,result:{proofId:result.proofId,proof,fixture:result},assignment:{irreversible:true,assetId:'synthetic-assigned-asset',level},disclosure:{selectedRevealed:true,participantsRevealed:true,mintPrefixRevealed:true},remainingQuotas:kind==='mint'?[...LEVEL_QUOTAS]:null,waiting:'fulfillment'};
}
