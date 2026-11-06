import {z} from 'zod';
import {stageModel,type Stage,type Receipt} from './models';
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const attemptModel=z.object({version:z.literal(1),wallet:z.string().min(1),inventoryId:z.string().min(1),stageId:z.string().min(1),key:z.string().min(1),
 body:z.object({expectedTermsDigest:digest}).strict(),stage:stageModel});
export type MintAttempt=z.infer<typeof attemptModel>;
export type MintJournalEntry={kind:'pending';name:string;attempt:MintAttempt}|{kind:'invalid';name:string};
const freeze=<T,>(value:T):T=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const selection=(inventoryId:string,stageId:string)=>JSON.stringify([inventoryId,stageId]);
const changed=()=>{if(typeof window!=='undefined')window.dispatchEvent(new Event('10x:mint-journal'));};
export function mintReviewAvailable(stage:Stage,nowMs:number){
 return digest.safeParse(stage.termsDigest).success&&stage.status==='open'&&stage.type!=='founder'&&!stage.openingHold&&stage.available>0&&
  stage.walletReservations!==null&&stage.walletReservations<stage.walletLimit&&
  (stage.eligibility?stage.eligibility.status==='eligible':stage.eligible===true)&&
  (!stage.reservationStatus||stage.reservationStatus.status==='available')&&Date.parse(stage.opensAt)<=nowMs&&nowMs<Date.parse(stage.closesAt);
}
export function matchesMintReceipt(attempt:MintAttempt,receipt:Receipt){
 return receipt.owner===attempt.wallet&&receipt.inventoryId===attempt.inventoryId&&receipt.kind==='mint'&&receipt.stageId===attempt.stageId&&
  receipt.termsDigest===attempt.body.expectedTermsDigest&&receipt.priceLamports===attempt.stage.priceLamports&&receipt.costLamports===attempt.stage.costLamports&&
  receipt.targetId===null&&receipt.materialId===null&&receipt.feeLamports===null&&
  (receipt.status==='awaiting-evidence'?receipt.assetId===null:receipt.status==='fulfilled'&&typeof receipt.assetId==='string'&&receipt.assetId.length>0);
}
/** Persist the reviewed public terms before sending. An unresolved request can
 * only be retried with its original body and key, independently of stage time. */
export function mintJournal(storage:StoragePort,wallet:string,newKey=()=>crypto.randomUUID()){
 const prefix='10x.mint.pending.v1:'+wallet+':';
 function decode(name:string):MintJournalEntry{
  try{const raw=storage.getItem(name);if(!raw||raw.length>16384)throw Error('Invalid stored request.');const attempt=attemptModel.parse(JSON.parse(raw));
   if(attempt.wallet!==wallet||name!==prefix+selection(attempt.inventoryId,attempt.stageId)||attempt.stage.id!==attempt.stageId||attempt.stage.termsDigest!==attempt.body.expectedTermsDigest)throw Error('Stored mint binding mismatch.');
   return {kind:'pending',name,attempt:freeze(attempt)};
  }catch{return {kind:'invalid',name};}
 }
 return {
  read(inventoryId:string,stageId:string){const name=prefix+selection(inventoryId,stageId);return storage.getItem(name)===null?null:decode(name);},
  list(){const names:string[]=[];for(let n=0;n<storage.length;n++){const name=storage.key(n);if(name?.startsWith(prefix))names.push(name);}return names.map(decode);},
  capture(inventoryId:string,stage:Stage,nowMs=Date.now()){
   const captured=stageModel.parse(stage),name=prefix+selection(inventoryId,captured.id),old=storage.getItem(name);
   if(old!==null){const entry=decode(name);if(entry.kind==='pending'&&entry.attempt.body.expectedTermsDigest===captured.termsDigest)return entry.attempt;throw Error('Resolve the retained mint request before reviewing new terms.');}
   if(!mintReviewAvailable(captured,nowMs))throw Error('Refresh the published stage and review its available terms before reserving.');
   const attempt=attemptModel.parse({version:1,wallet,inventoryId,stageId:captured.id,key:newKey(),body:{expectedTermsDigest:captured.termsDigest},stage:captured}),serialized=JSON.stringify(attempt);
   if(serialized.length>16384)throw Error('The reviewed mint request is too large to retain safely.');storage.setItem(name,serialized);
   const entry=decode(name);if(entry.kind==='invalid')throw Error('The reviewed mint request could not be retained safely.');changed();return entry.attempt;
  },
  complete(attempt:MintAttempt){const name=prefix+selection(attempt.inventoryId,attempt.stageId),entry=storage.getItem(name)===null?null:decode(name);if(entry?.kind==='pending'&&entry.attempt.key===attempt.key&&entry.attempt.body.expectedTermsDigest===attempt.body.expectedTermsDigest){storage.removeItem(name);changed();}},
 };
}
