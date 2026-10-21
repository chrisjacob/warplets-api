import {describe,expect,it} from "vitest";
import {latencySummary,summarizeCpuProfile,type CpuProfile} from "../../scripts/lib/discovery-read-runtime-metrics";
const frame=(functionName:string,url="")=>({functionName,url,lineNumber:0,columnNumber:0});
const profile=():CpuProfile=>({startTime:0,endTime:10000,nodes:[{id:1,callFrame:frame("(root)"),children:[2,4,5]},{id:2,callFrame:frame("reader","reader.ts"),children:[3]},
  {id:3,callFrame:frame("JSON.parse")},{id:4,callFrame:frame("(idle)")},{id:5,callFrame:frame("(garbage collector)")}],samples:[3,2,4,5],timeDeltas:[1000,2000,3000,4000]});
describe("runtime-study evidence accounting",()=>{
  it("uses nearest-rank percentiles, includes tail latency, and does not mutate input",()=>{
    const values=[10,1,4,2];expect(latencySummary(values)).toEqual({requests:4,p50_ms:2,p95_ms:10,max_ms:10,mean_ms:4.25});expect(values).toEqual([10,1,4,2]);
    for(const bad of [[],[-1],[NaN],[Infinity]])expect(()=>latencySummary(bad)).toThrow();
  });
  it("attributes native child samples to the mapped caller while retaining idle and GC without claiming CPU",()=>{
    const actual=summarizeCpuProfile(profile(),f=>f.url||null);expect(actual).toMatchObject({samples:4,sampled_elapsed_ms:10,profile_elapsed_ms:10,cpu_acceptance:false});
    expect(actual.attribution).toEqual([{source:"(garbage collector)",samples:1,sampled_elapsed_ms:4},{source:"reader.ts",samples:2,sampled_elapsed_ms:3},{source:"(idle)",samples:1,sampled_elapsed_ms:3}]);
    expect(actual.attribution.reduce((n,s)=>n+s.sampled_elapsed_ms,0)).toBe(10);
  });
  it("rejects missing/duplicate samples, broken trees and cycles instead of reporting fabricated timings",()=>{
    const bad=profile();bad.samples=[99];bad.timeDeltas=[1];expect(()=>summarizeCpuProfile(bad,()=>null)).toThrow();
    const mismatch=profile();mismatch.timeDeltas=[];expect(()=>summarizeCpuProfile(mismatch,()=>null)).toThrow();
    const duplicate=profile();duplicate.nodes.push(duplicate.nodes[0]!);expect(()=>summarizeCpuProfile(duplicate,()=>null)).toThrow();
    const cycle=profile();cycle.nodes[1]!.children=[1];expect(()=>summarizeCpuProfile(cycle,()=>null)).toThrow();
    const negative=profile();negative.timeDeltas![0]=-1;expect(()=>summarizeCpuProfile(negative,()=>null)).toThrow();
    for(const endTime of [-1,NaN,Infinity])expect(()=>summarizeCpuProfile({...profile(),endTime},()=>null)).toThrow();
  });
  it("preserves unmapped/native samples explicitly instead of inventing an application source",()=>{
    const result=summarizeCpuProfile(profile(),()=>null);
    expect(result.attribution).toContainEqual({source:"unattributed/runtime",samples:2,sampled_elapsed_ms:3});
    expect(result.attribution.reduce((n,s)=>n+s.samples,0)).toBe(result.samples);
  });
});
