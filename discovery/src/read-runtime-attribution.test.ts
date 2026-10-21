import {describe,it,expect} from "vitest";
import {attributeRuntimeProfile,type ProfileSourceMap} from "../../scripts/lib/discovery-read-runtime-attribution";

const frame=(functionName:string,url="",lineNumber=-1,columnNumber=-1)=>({functionName,url,lineNumber,columnNumber});
const fixture=()=>({startTime:0,endTime:20000,nodes:[
  {id:1,callFrame:frame("(root)"),children:[2,5,6,7,8]},
  {id:2,callFrame:frame("reader","reader-runtime.mjs",0,0),children:[3],hitCount:1,positionTicks:[{line:2,ticks:1},{line:2,ticks:2},{line:3,ticks:1}]},
  {id:3,callFrame:frame("parse","reader-runtime.mjs",2,0),children:[4]},
  {id:4,callFrame:frame("native"),hitCount:1},
  {id:5,callFrame:frame("(idle)")},{id:6,callFrame:frame("(garbage collector)")},{id:7,callFrame:frame("(program)")},{id:8,callFrame:frame("unknown")}],
  samples:[2,4,5,6,7,8],timeDeltas:[1000,2000,3000,4000,5000,5000]});
const source=(line:number)=>({source:"discovery/src/score-read-pages.ts",line,column:0});
const mapping:ProfileSourceMap={frame:line=>line===1?source(90):{source:"node_modules/zod/parse.js",line:1,column:0},
  line:line=>line===2?[source(105),source(105),{...source(105),column:10},source(106)]:[]};

describe("saved runtime line/stack attribution",()=>{
  it("conserves every self sample/time delta, keeps native frames and separates inclusive context",()=>{
    const result=attributeRuntimeProfile(fixture(),10,mapping);
    expect(result).toMatchObject({samples:6,sampled_elapsed_ms:20,position_ticks:4,cpu_acceptance:false,promotion_authorized:false});
    expect(result.frames.reduce((n,f)=>n+f.self_samples,0)).toBe(6);expect(result.frames.reduce((n,f)=>n+f.self_sampled_elapsed_ms,0)).toBe(20);
    expect(result.frames.find(f=>f.id===4)).toMatchObject({function:"native",original_function:null,self_samples:1,parent_id:3});
    expect(result.nearest_project_function).toContainEqual({location:source(90),samples:2,sampled_elapsed_ms:3});
    for(const location of ["(idle)","(garbage collector)","(program)","unattributed/runtime"])expect(result.nearest_project_function.some(g=>g.location===location)).toBe(true);
  });
  it("aggregates repeated generated-line ticks while preserving ambiguity and missing maps without invented columns/time",()=>{
    const result=attributeRuntimeProfile(fixture(),10,mapping),line=result.lines[0]!;
    expect(line).toEqual({node_id:2,function:"reader",url:"reader-runtime.mjs",generated_line:2,ticks:3,original_line_candidates:[{source:source(105).source,line:105},{source:source(106).source,line:106}],mapping:"ambiguous_source_lines"});
    expect(result.lines[1]).toMatchObject({ticks:1,original_line_candidates:[],mapping:"unmapped"});
    const missing=attributeRuntimeProfile(fixture(),10,{frame:()=>null,line:()=>[]});expect(missing.nearest_project_function.find(g=>g.location==="unattributed/runtime")!.samples).toBe(3);
  });
  it("rejects malformed samples, unsampled cycles/disconnected nodes, duplicate parents and out-of-bounds ticks",()=>{
    const mutations:((p:ReturnType<typeof fixture>)=>void)[]=[p=>{p.samples[0]=99;},p=>{p.timeDeltas.pop();},p=>{p.timeDeltas[0]=-1;},p=>{p.endTime=-1;},
      p=>{p.nodes.push(p.nodes[0]!);},p=>{p.nodes.push({id:9,callFrame:frame("unsampled-a"),children:[10]},{id:10,callFrame:frame("unsampled-b"),children:[9]});},
      p=>{p.nodes[7]!.children=[8];},p=>{p.nodes[0]!.children!.pop();},p=>{p.nodes[2]!.children=[4,8];},
      p=>{p.nodes[1]!.positionTicks![0]!.line=11;},p=>{p.nodes[1]!.positionTicks![0]!.ticks=-1;},p=>{p.nodes[1]!.callFrame.lineNumber=10;}];
    for(const mutate of mutations){const p=fixture();mutate(p);expect(()=>attributeRuntimeProfile(p,10,mapping)).toThrow();}
    expect(()=>attributeRuntimeProfile(fixture(),10,{frame:()=>({...source(1),line:0}),line:()=>[]})).toThrow();
    const overflow=fixture();overflow.nodes[1]!.positionTicks=[{line:1,ticks:Number.MAX_SAFE_INTEGER},{line:1,ticks:1}];expect(()=>attributeRuntimeProfile(overflow,10,mapping)).toThrow();
  });
});
