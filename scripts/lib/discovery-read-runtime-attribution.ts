import {z} from "zod";

const Count=z.number().int().safe().nonnegative(),Id=Count.positive();
const Frame=z.object({functionName:z.string().max(4096),url:z.string().max(8192),lineNumber:z.number().int().safe().min(-1),columnNumber:z.number().int().safe().min(-1)}).passthrough();
const Profile=z.object({startTime:Count,endTime:Count,nodes:z.object({id:Id,callFrame:Frame,children:Id.array().max(10000).optional(),hitCount:Count.optional(),
  positionTicks:z.object({line:Id,ticks:Count}).strict().array().max(200000).optional()}).passthrough().array().min(1).max(10000),
  samples:Id.array().min(1).max(200000),timeDeltas:Count.array().min(1).max(200000)}).passthrough();
export type SourcePosition={source:string;line:number;column:number}; // original line 1-based, column 0-based
export type ProfileSourceMap={frame:(line:number,column:number)=>SourcePosition|null;line:(line:number)=>SourcePosition[]};
const special=new Set(["(idle)","(garbage collector)","(program)"]);
const project=(source:string)=>source.startsWith("discovery/src/")||source.startsWith("scripts/lib/");
const key=(value:unknown)=>JSON.stringify(value);

// Function frames identify declarations, NOT exact execution/call positions.
// Position ticks identify generated lines only. Never assign them a column,
// timeDelta, native-child cost or invented exact source expression.
export function attributeRuntimeProfile(input:unknown,bundleLines:number,mapping:ProfileSourceMap){
  const profile=Profile.parse(input);
  if(!Number.isSafeInteger(bundleLines)||bundleLines<1||profile.endTime<profile.startTime||profile.samples.length!==profile.timeDeltas.length)throw Error("invalid_profile_accounting");
  const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map<number,number>();
  if(nodes.size!==profile.nodes.length)throw Error("duplicate_profile_node");
  for(const n of nodes.values())for(const child of n.children??[]){if(!nodes.has(child)||parents.has(child))throw Error("invalid_profile_parent");parents.set(child,n.id);}
  const root=profile.nodes[0]!.id,visited=new Set<number>(),pending:[number,number][]=[[root,0]];
  while(pending.length){const [id,depth]=pending.pop()!;if(visited.has(id)||depth>512)throw Error("invalid_profile_tree");visited.add(id);for(const child of nodes.get(id)!.children??[])pending.push([child,depth+1]);}
  if(parents.has(root)||visited.size!==nodes.size)throw Error("disconnected_profile_tree");
  const self=new Map<number,{samples:number;sampled_elapsed_us:number}>();
  for(const [i,id] of profile.samples.entries()){
    if(!nodes.has(id))throw Error("missing_profile_sample");const value=self.get(id)??{samples:0,sampled_elapsed_us:0};value.samples++;value.sampled_elapsed_us+=profile.timeDeltas[i]!;self.set(id,value);
  }
  const totalUs=profile.timeDeltas.reduce((sum,value)=>sum+value,0);if(!Number.isSafeInteger(totalUs))throw Error("profile_time_overflow");
  const points=(positions:SourcePosition[])=>{const result=new Map<string,SourcePosition>();for(const p of positions){if(!p.source||!Number.isSafeInteger(p.line)||p.line<1||!Number.isSafeInteger(p.column)||p.column<0)throw Error("invalid_source_mapping");result.set(key(p),p);}return [...result.values()].sort((a,b)=>(a.source<b.source?-1:a.source>b.source?1:0)||a.line-b.line||a.column-b.column);};
  const frames=profile.nodes.map(n=>{
    const frame=n.callFrame,bundled=frame.url==="reader-runtime.mjs";
    if(bundled&&(frame.lineNumber<0||frame.lineNumber>=bundleLines||frame.columnNumber<0))throw Error("invalid_bundle_frame");
    const source=bundled?mapping.frame(frame.lineNumber+1,frame.columnNumber):null;
    if(source)points([source]);
    const counts=self.get(n.id)??{samples:0,sampled_elapsed_us:0};
    return {id:n.id,parent_id:parents.get(n.id)??null,function:frame.functionName,url:frame.url,generated_function_line:bundled?frame.lineNumber+1:null,
      generated_function_column:bundled?frame.columnNumber:null,original_function:source,reported_hit_count:n.hitCount??null,self_samples:counts.samples,self_sampled_elapsed_ms:counts.sampled_elapsed_us/1000};
  });
  const frameById=new Map(frames.map(f=>[f.id,f])),groups=new Map<string,{location:string|SourcePosition;samples:number;sampled_elapsed_ms:number}>();
  for(const frame of frames){if(!frame.self_samples)continue;let current:typeof frame|undefined=frame,location:string|SourcePosition="unattributed/runtime";
    while(current){if(special.has(current.function)){location=current.function;break;}if(current.original_function&&project(current.original_function.source)){location=current.original_function;break;}current=current.parent_id===null?undefined:frameById.get(current.parent_id);}
    const id=key(location),group=groups.get(id)??{location,samples:0,sampled_elapsed_ms:0};group.samples+=frame.self_samples;group.sampled_elapsed_ms+=frame.self_sampled_elapsed_ms;groups.set(id,group);
  }
  let tickRecords=0,totalTicks=0;const lines=[];
  for(const node of profile.nodes){const ticks=new Map<number,number>();for(const tick of node.positionTicks??[]){if(++tickRecords>200000)throw Error("profile_tick_limit");ticks.set(tick.line,(ticks.get(tick.line)??0)+tick.ticks);totalTicks+=tick.ticks;}
    for(const [line,count] of ticks){if(!Number.isSafeInteger(count)||!Number.isSafeInteger(totalTicks))throw Error("profile_tick_overflow");
      const bundled=node.callFrame.url==="reader-runtime.mjs";if(bundled&&line>bundleLines)throw Error("invalid_bundle_tick");
      const candidates=bundled?points(mapping.line(line)):[],originalLines=[...new Set(candidates.map(p=>key([p.source,p.line])))].map(v=>{const [source,line]=JSON.parse(v) as [string,number];return {source,line};});
      lines.push({node_id:node.id,function:node.callFrame.functionName,url:node.callFrame.url,generated_line:line,ticks:count,original_line_candidates:originalLines,
        mapping:originalLines.length===0?"unmapped":originalLines.length===1?"one_source_line":"ambiguous_source_lines"});
    }
  }
  return {samples:profile.samples.length,profile_elapsed_ms:(profile.endTime-profile.startTime)/1000,sampled_elapsed_ms:totalUs/1000,position_ticks:totalTicks,
    frames:frames.sort((a,b)=>b.self_samples-a.self_samples||a.id-b.id),nearest_project_function:[...groups.values()].sort((a,b)=>b.samples-a.samples),
    lines:lines.sort((a,b)=>b.ticks-a.ticks||a.node_id-b.node_id||a.generated_line-b.generated_line),cpu_acceptance:false,promotion_authorized:false,
    semantics:"Self samples conserve every leaf and timeDelta; nearest project function is inclusive context, not an exact call site. Line ticks are separate counts with all source-line candidates, no expression/column/time allocation. Idle/GC/program/native/unmapped frames retained; not billed CPU or causal evidence."};
}
