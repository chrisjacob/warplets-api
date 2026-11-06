import {z} from 'zod';
import {assetModel,quoteModel,type Asset,type ProgressQuote,type Receipt} from './models';
import type {ProgressionReservationRequest} from './sdk';
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
const bodyModel=z.object({kind:z.enum(['visual','upgrade']),targetId:z.string(),materialId:z.string().optional(),expectedTargetVersion:z.number().int().nonnegative(),expectedMaterialVersion:z.number().int().nonnegative().optional(),
 quoteId:z.string(),bindingDigest:z.string().regex(/^[a-f0-9]{64}$/),policyVersion:z.string(),reviewedFeeLamports:z.string().regex(/^(0|[1-9][0-9]*)$/),reviewedMaxTotalLamports:z.string().regex(/^(0|[1-9][0-9]*)$/),quoteExpiresMs:z.number().int().nonnegative()}).strict();
const attemptModel=z.object({version:z.literal(1),wallet:z.string(),inventoryId:z.string(),key:z.string().min(1),body:bodyModel,quote:quoteModel,
 selection:z.object({target:assetModel,material:assetModel.optional()})});
export type ProgressionAttempt=z.infer<typeof attemptModel>;
export type ProgressionJournalEntry={kind:'pending';name:string;attempt:ProgressionAttempt}|{kind:'invalid';name:string};
export function matchesProgressionReceipt(attempt:ProgressionAttempt,receipt:Receipt){
 return receipt.owner===attempt.wallet&&receipt.inventoryId===attempt.inventoryId&&receipt.kind===attempt.body.kind&&receipt.targetId===attempt.body.targetId&&
  (receipt.materialId??null)===(attempt.body.materialId??null)&&receipt.quoteId===attempt.body.quoteId&&receipt.bindingDigest===attempt.body.bindingDigest&&receipt.feeLamports===attempt.body.reviewedFeeLamports;
}
const freeze=<T,>(value:T):T=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
export function reviewedProgressionBody(quote:ProgressQuote):ProgressionReservationRequest{
 const q=quoteModel.parse(quote);
 if(q.kind==='upgrade'?(q.materialId===null||q.materialVersion===null):(q.materialId!==null||q.materialVersion!==null))throw Error('The quote participant binding is incomplete.');
 if(BigInt(q.maxTotalLamports)<BigInt(q.feeLamports)||Date.parse(q.expiresAt)!==q.quoteExpiresMs)throw Error('The reviewed quote terms are inconsistent.');
 return freeze(bodyModel.parse({kind:q.kind,targetId:q.targetId,expectedTargetVersion:q.targetVersion,
  ...(q.kind==='upgrade'?{materialId:q.materialId,expectedMaterialVersion:q.materialVersion}:{}),quoteId:q.quoteId,bindingDigest:q.bindingDigest,policyVersion:q.policyVersion,
  reviewedFeeLamports:q.feeLamports,reviewedMaxTotalLamports:q.maxTotalLamports,quoteExpiresMs:q.quoteExpiresMs}));
}
export const progressionSelection=(inventoryId:string,targetId:string,materialId?:string|null)=>JSON.stringify([inventoryId,targetId,materialId??null]);
const changed=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('10x:progression-journal'));};
/** Captured before sending; never replace an unknown outcome with a new quote or
 * key. Entries remain isolated by authenticated wallet across reconnects. */
export function progressionJournal(storage:StoragePort,wallet:string,newKey=()=>crypto.randomUUID()){
 const prefix='10x.progression.pending.v1:'+wallet+':';
 function decode(name:string):ProgressionJournalEntry{
  try{
   const raw=storage.getItem(name);if(!raw||raw.length>65536)throw Error('Invalid stored request.');const attempt=attemptModel.parse(JSON.parse(raw)),q=attempt.quote;
   if(attempt.wallet!==wallet||attempt.inventoryId!==q.inventoryId||name!==prefix+progressionSelection(attempt.inventoryId,q.targetId,q.materialId)||JSON.stringify(attempt.body)!==JSON.stringify(reviewedProgressionBody(q)))throw Error('Stored request binding mismatch.');
   const {target,material}=attempt.selection;
   if(target.owner!==wallet||target.inventoryId!==q.inventoryId||target.id!==q.targetId||target.version!==q.targetVersion||(q.kind==='upgrade'&&(!material||material.owner!==wallet||material.inventoryId!==q.inventoryId||material.id!==q.materialId||material.version!==q.materialVersion))||(q.kind==='visual'&&material))throw Error('Stored selection binding mismatch.');
   return {kind:'pending',name,attempt:freeze(attempt)};
  }catch{return {kind:'invalid',name};}
 }
 return {
  read(inventoryId:string,targetId:string,materialId?:string|null){const name=prefix+progressionSelection(inventoryId,targetId,materialId);return storage.getItem(name)===null?null:decode(name);},
  list(){const names:string[]=[];for(let n=0;n<storage.length;n++){const name=storage.key(n);if(name?.startsWith(prefix))names.push(name);}return names.map(decode);},
  capture(quote:ProgressQuote,selection:{target:Asset;material?:Asset}){
   const q=quoteModel.parse(quote),name=prefix+progressionSelection(q.inventoryId,q.targetId,q.materialId),body=reviewedProgressionBody(q),old=storage.getItem(name);
   if(old!==null){const found=decode(name);if(found.kind==='pending'&&JSON.stringify(found.attempt.body)===JSON.stringify(body))return found.attempt;throw Error('Resolve the retained request before reviewing new terms.');}
   const attempt=attemptModel.parse({version:1,wallet,inventoryId:q.inventoryId,key:newKey(),body,quote:q,selection}),serialized=JSON.stringify(attempt);
   if(serialized.length>65536)throw Error('The reviewed request is too large to retain safely.');storage.setItem(name,serialized);
   const checked=decode(name);if(checked.kind==='invalid'){storage.removeItem(name);throw Error('The reviewed selection no longer matches the quote.');}changed();return checked.attempt;
  },
  complete(attempt:ProgressionAttempt){const name=prefix+progressionSelection(attempt.inventoryId,attempt.body.targetId,attempt.body.materialId),entry=storage.getItem(name)===null?null:decode(name);if(entry?.kind==='pending'&&entry.attempt.key===attempt.key){storage.removeItem(name);changed();}},
 };
}
