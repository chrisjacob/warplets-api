// Pinned offline beacon request protocol. No provider call or entropy generation.
export const CHAIN='52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971';
export const genesisMs=1692803367000,periodMs=3000,leadMs=30000;
export const roundTime=round=>genesisMs+(round-1)*periodMs;
export function futureRound(createdMs){
 if(!Number.isSafeInteger(createdMs)||createdMs<genesisMs)throw Error('Commitment predates pinned beacon.');
 return 1+Math.ceil((createdMs+leadMs-genesisMs)/periodMs);
}
export function drawRequestPreimage(policy,op){
 if(op.now<policy.registered_ms)throw Error('Reservation predates draw terms.');
 const targetRound=futureRound(op.now);
 return {targetRound,preimage:['10x-draw-context-v1',policy.policy_hash,op.inventoryId,op.opId,op.kind,op.owner,op.commitment,op.now,targetRound]};
}
