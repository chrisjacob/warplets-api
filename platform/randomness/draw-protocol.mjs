import {CHAIN} from './request-plan.mjs';
export const traitFields=Object.freeze(['model','backdrop','symbol']);
export const uniformPreimage=(seed,label,index)=>['10x-uniform-v1',seed,label,index];
export const beaconSeedPreimage=(contextDigest,randomness)=>['10x-beacon-v1',contextDigest,randomness];
export const beaconProofPreimage=(round,seed)=>[CHAIN,round,seed];
export function uniformCandidate(hash,size){
 if(!Number.isSafeInteger(size)||size<1||typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid draw range or digest.');
 const n=BigInt(size),range=1n<<256n,limit=range-range%n,x=BigInt('0x'+hash);return x<limit?Number(x%n):null;
}
export function validateTraitField(options,field='traits'){
 if(!Array.isArray(options)||!options.length||options.length>256)throw Error('Provide weighted choices for '+field);
 const names=new Set();for(const item of options){if(!item||typeof item.name!=='string'||!item.name.trim()||item.name.length>128||names.has(item.name)||!Number.isInteger(item.weight)||item.weight<1||item.weight>1000000)throw Error('Invalid weighted trait.');names.add(item.name);}
 return options.map(({name,weight})=>({name,weight}));
}
export function validateTraitChoices(rows){return Object.fromEntries(traitFields.map(field=>[field,validateTraitField(rows?.[field],field)]));}
export function pickTrait(choices,pick){for(const choice of choices){if(pick<choice.weight)return choice.name;pick-=choice.weight;}throw Error('Invalid trait weights.');}
