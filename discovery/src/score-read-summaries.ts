import {z} from "zod";
import {Address} from "./model";
import {ScoreSummaryV4Schema} from "./discovery-score-v4-model";

export const ScoreSummaryRowsSchema=z.object({address:Address,discovery_score:ScoreSummaryV4Schema}).strict().array().min(1).max(25);
type Summaries=z.infer<typeof ScoreSummaryRowsSchema>;
const S=ScoreSummaryV4Schema.shape,Ref=z.number().int().min(0).max(24);
const Header=ScoreSummaryV4Schema.pick({version:true,as_of:true,policy_hash:true}).strict();
const Row=z.tuple([Address,Ref,S.value,S.evidence_coverage,S.ceiling,S.input_hash,S.result_hash,S.record_hash,Ref]);
// All original field schemas are reused. Version/date/policy and complete flag
// arrays are shared only when exactly equal, never inferred from the manifest.
// Restore full-summary parsing if the original gains cross-field refinements.
export const PackedScoreSummariesSchema=z.object({headers:Header.array().min(1).max(25),flags:S.risk_flags.array().min(1).max(25),rows:Row.array().min(1).max(25)}).strict().superRefine((value,ctx)=>{
  for(const [column,values] of [[1,value.headers],[8,value.flags]] as const){
    const seen=new Map<string,number>(),keys=values.map(item=>JSON.stringify(item));
    for(const [i,row] of value.rows.entries()){
      const ref=row[column],item=values[ref];
      if(item===undefined){ctx.addIssue({code:"custom",path:["rows",i,column],message:"Invalid summary dictionary reference"});continue;}
      const key=keys[ref]!,prior=seen.get(key);
      if(prior===undefined){if(ref!==seen.size)ctx.addIssue({code:"custom",path:["rows",i,column],message:"Noncanonical summary dictionary"});seen.set(key,ref);}
      else if(prior!==ref)ctx.addIssue({code:"custom",path:["rows",i,column],message:"Duplicate summary dictionary value"});
    }
    if(seen.size!==values.length)ctx.addIssue({code:"custom",message:"Unused summary dictionary entries"});
  }
});
type Packed=z.infer<typeof PackedScoreSummariesSchema>;

// Callers validate the original rows before encoding, and the full stored
// envelope before decoding. Hash the reconstructed ORIGINAL rows, not tuples.
export function packScoreSummaries(summaries:Summaries):Packed {
  const headers:Packed["headers"]=[],flags:Packed["flags"]=[],headerIds=new Map<string,number>(),flagIds=new Map<string,number>();
  const intern=<T>(values:T[],ids:Map<string,number>,value:T)=>{const key=JSON.stringify(value),old=ids.get(key);if(old!==undefined)return old;const i=values.length;values.push(value);ids.set(key,i);return i;};
  return {headers,flags,rows:summaries.map(({address,discovery_score:s})=>[
    address,intern(headers,headerIds,{version:s.version,as_of:s.as_of,policy_hash:s.policy_hash}),s.value,s.evidence_coverage,s.ceiling,s.input_hash,s.result_hash,s.record_hash,intern(flags,flagIds,s.risk_flags)])};
}
export function unpackScoreSummaries(value:Packed):Summaries {
  return value.rows.map(([address,header,valueScore,evidence_coverage,ceiling,input_hash,result_hash,record_hash,flags])=>{
    const h=value.headers[header]!;
    // Preserve ScoreSummaryV4Schema's exact original field order for its hash.
    return {address,discovery_score:{version:h.version,as_of:h.as_of,value:valueScore,evidence_coverage,ceiling,input_hash,policy_hash:h.policy_hash,result_hash,record_hash,risk_flags:value.flags[flags]!}};
  });
}
