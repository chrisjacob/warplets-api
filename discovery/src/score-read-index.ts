import {z} from "zod";
import {Address} from "./model";

const Hash=z.string().regex(/^[a-f0-9]{64}$/),TextRef=z.number().int().min(0).max(999);
const Eligibility=z.enum(["eligible","provisional","excluded"]),Freshness=z.enum(["fresh","stale","missing"]);
const Time=z.iso.datetime().nullable(),Score=z.number().finite().min(0).max(100),Liquidity=z.number().finite().nonnegative().nullable(),Page=z.number().int().min(0).max(19);
export const ScoreReadEntrySchema=z.object({address:Address,name:z.string().max(100),symbol:z.string().max(32),eligibility:Eligibility,
  creation_at:Time,score:Score,coverage:Score,liquidity:Liquidity,freshness:Freshness,card_hash:Hash,body_hash:Hash,score_page:Page}).strict();
type Entry=z.infer<typeof ScoreReadEntrySchema>;

// Fixed order is part of the v3 serving contract. Keep every original field and
// hex digest; only repeated object keys and repeated identity text are removed.
const Row=z.tuple([Address,TextRef,TextRef,Eligibility,Time,Score,Score,Liquidity,Freshness,Hash,Hash,Page]);
export const PackedScoreInventorySchema=z.object({text:z.string().max(100).array().max(1000),rows:Row.array().max(500)}).strict().superRefine((value,ctx)=>{
  const seen=new Map<string,number>();
  for(const [i,row] of value.rows.entries())for(const column of [1,2] as const){
    const ref=row[column],text=value.text[ref];
    if(text===undefined||column===2&&text.length>32){ctx.addIssue({code:"custom",path:["rows",i,column],message:"Invalid identity text reference"});continue;}
    const prior=seen.get(text);
    if(prior===undefined){if(ref!==seen.size)ctx.addIssue({code:"custom",path:["rows",i,column],message:"Noncanonical identity dictionary"});seen.set(text,ref);}
    else if(prior!==ref)ctx.addIssue({code:"custom",path:["rows",i,column],message:"Duplicate identity dictionary value"});
  }
  if(seen.size!==value.text.length)ctx.addIssue({code:"custom",path:["text"],message:"Unused identity dictionary entries"});
});
type Packed=z.infer<typeof PackedScoreInventorySchema>;

// The caller strictly validates the complete manifest before publishing or
// decoding it. No normalization, case folding, truncation or default values.
export function packScoreInventory(entries:Entry[]):Packed {
  const text:string[]=[],lookup=new Map<string,number>();
  const intern=(s:string)=>{const old=lookup.get(s);if(old!==undefined)return old;const i=text.length;text.push(s);lookup.set(s,i);return i;};
  return {text,rows:entries.map(e=>[e.address,intern(e.name),intern(e.symbol),e.eligibility,e.creation_at,e.score,e.coverage,e.liquidity,e.freshness,e.card_hash,e.body_hash,e.score_page])};
}
export function unpackScoreInventory(value:Packed):Entry[] {
  return value.rows.map(([address,name,symbol,eligibility,creation_at,score,coverage,liquidity,freshness,card_hash,body_hash,score_page])=>({
    address,name:value.text[name]!,symbol:value.text[symbol]!,eligibility,creation_at,score,coverage,liquidity,freshness,card_hash,body_hash,score_page}));
}
