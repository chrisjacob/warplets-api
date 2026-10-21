import {describe,expect,it} from "vitest";
import {ScoreSummaryV4Schema} from "./discovery-score-v4-model";
import {ScoreSummaryRowsSchema,PackedScoreSummariesSchema,packScoreSummaries,unpackScoreSummaries} from "./score-read-summaries";
import {hashJson,toBase58} from "./solana";
import {storedJsonHash} from "./stored-json-hash";

const time="2026-10-22T01:00:00.000Z";
const summary=ScoreSummaryV4Schema.parse({version:"discovery-score-v4",as_of:time,value:50,evidence_coverage:75,ceiling:80,input_hash:"1".repeat(64),policy_hash:"2".repeat(64),result_hash:"3".repeat(64),record_hash:"4".repeat(64),risk_flags:[{code:"Concern",ceiling:80,observed_at:null}]});
const rows=(n=25)=>ScoreSummaryRowsSchema.parse(Array.from({length:n},(_,i)=>{const bytes=new Uint8Array(32).fill(7);bytes[0]=i;return {address:toBase58(bytes),discovery_score:{...summary,value:i*4,
  as_of:i%3?time:"2026-10-22T01:00:01.000Z",policy_hash:(i%2?"a":"b").repeat(64),risk_flags:i%3?summary.risk_flags:[]}};}));
const packed=()=>packScoreSummaries(rows(2));
describe("lossless score-summary pages",()=>{
  it("preserves every original field, member order, differing header, flag order/duplicates and original digest",async()=>{
    const values=rows();values[1]!.discovery_score.risk_flags=[{code:"\u0000\ud800漢🙂",ceiling:0,observed_at:time},summary.risk_flags[0]!,summary.risk_flags[0]!];
    values[2]!.discovery_score.risk_flags=Array.from({length:24},(_,i)=>({code:"x".repeat(98)+i,ceiling:i/4,observed_at:i%2?time:null}));
    const original=ScoreSummaryRowsSchema.parse(values),decoded=unpackScoreSummaries(PackedScoreSummariesSchema.parse(packScoreSummaries(original)));
    expect(JSON.stringify(decoded)).toBe(JSON.stringify(original));expect(await hashJson(original)).toBe(storedJsonHash(decoded));
    for(const row of decoded)expect(ScoreSummaryV4Schema.parse(row.discovery_score)).toEqual(row.discovery_score);
  });
  it("shares only exact original values and keeps the complete original schema key order",()=>{
    const values=rows(25).map(r=>({...r,discovery_score:{...summary}})),p=packScoreSummaries(values);
    expect(p.headers).toHaveLength(1);expect(p.flags).toHaveLength(1);expect(p.rows).toHaveLength(25);
    expect(Object.keys(unpackScoreSummaries(PackedScoreSummariesSchema.parse(p))[0]!.discovery_score)).toEqual(Object.keys(ScoreSummaryV4Schema.shape));
    expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(Buffer.byteLength(JSON.stringify(values)));
  });
  it("rejects invalid scalar fields and missing/extra tuple members using the original constraints",()=>{
    const bad:Record<number,unknown[]>={0:["bad"],1:[-1,.5,25],2:[-1,101,.5],3:[-1,101,.5],4:[-1,101,NaN],5:["1".repeat(63)],6:["g".repeat(64)],7:[null],8:[-1,.5,25]};
    for(const [column,values] of Object.entries(bad))for(const value of values){const p=packed();(p.rows[0] as unknown[])[Number(column)]=value;expect(PackedScoreSummariesSchema.safeParse(p).success).toBe(false);}
    for(const value of [{...packed(),extra:1},{...packed(),rows:[]},{...packed(),headers:[]},{...packed(),flags:[]},
      {...packed(),rows:Array.from({length:26},()=>packed().rows[0])},{...packed(),rows:[packed().rows[0]!.slice(0,-1)]},{...packed(),rows:[[...packed().rows[0]!,1]]}])expect(PackedScoreSummariesSchema.safeParse(value).success).toBe(false);
  });
  it("rejects bad shared fields, dangling/duplicate/unused/noncanonical dictionaries and oversized flag sets",()=>{
    const mutations:((p:ReturnType<typeof packed>)=>void)[]=[p=>{p.rows[0]![1]=24;},p=>{p.rows[0]![8]=24;},
      p=>{p.headers[0]!.as_of="bad";},p=>{p.headers[0]!.policy_hash="a";},p=>{Object.assign(p.headers[0]!,{extra:1});},
      p=>{Object.assign(p.headers[0]!,{version:"discovery-score-v3"});},p=>{p.flags[1]![0]!.code="x".repeat(101);},
      p=>{p.flags[1]![0]!.ceiling=101;},p=>{p.flags[1]![0]!.observed_at="bad";},p=>{Object.assign(p.flags[1]![0]!,{extra:true});},
      p=>{p.flags[0]=Array.from({length:25},()=>summary.risk_flags[0]!);},p=>{p.headers.push({...p.headers[0]!});},p=>{p.flags.push([]);},
      p=>{p.headers.push({...p.headers[0]!});p.rows[1]![1]=2;},p=>{p.flags.push([]);p.rows[1]![8]=2;},
      p=>{p.headers.reverse();for(const row of p.rows)row[1]=1-row[1];},p=>{p.flags.reverse();for(const row of p.rows)row[8]=1-row[8];}];
    for(const mutate of mutations){const p=packed();mutate(p);expect(PackedScoreSummariesSchema.safeParse(p).success).toBe(false);}
  });
});
