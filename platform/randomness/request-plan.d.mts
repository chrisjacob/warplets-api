export const CHAIN:string;
export const genesisMs:number,periodMs:3000,leadMs:30000;
export function roundTime(round:number):number;
export function futureRound(createdMs:number):number;
export function drawRequestPreimage(policy:{policy_hash:string;registered_ms:number},operation:{opId:string;inventoryId:string;kind:string;owner:string;commitment:string;now:number}):{targetRound:number;preimage:readonly (string|number)[]};
