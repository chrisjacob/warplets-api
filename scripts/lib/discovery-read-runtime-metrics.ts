export type CpuFrame={functionName:string;url:string;lineNumber:number;columnNumber:number};
export type CpuProfile={nodes:{id:number;callFrame:CpuFrame;children?:number[]}[];samples?:number[];timeDeltas?:number[];startTime:number;endTime:number};

export function latencySummary(values:number[]){
  if(!values.length||values.some(v=>!Number.isFinite(v)||v<0))throw Error("invalid_latency_samples");
  const sorted=[...values].sort((a,b)=>a-b),percentile=(p:number)=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]!;
  return {requests:values.length,p50_ms:percentile(.5),p95_ms:percentile(.95),max_ms:sorted.at(-1)!,mean_ms:values.reduce((a,b)=>a+b,0)/values.length};
}

// V8 samples/timeDeltas are sampled elapsed time, including idle and GC. They
// support attribution; they are NOT per-request CPU or Cloudflare billing.
export function summarizeCpuProfile(profile:CpuProfile,sourceFor:(frame:CpuFrame)=>string|null){
  const samples=profile.samples??[],deltas=profile.timeDeltas??[];
  if(!Number.isFinite(profile.startTime)||!Number.isFinite(profile.endTime)||profile.endTime<profile.startTime)throw Error("invalid_cpu_clock");
  if(!samples.length||samples.length!==deltas.length||deltas.some(t=>!Number.isFinite(t)||t<0))throw Error("invalid_cpu_samples");
  const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map<number,number>();
  if(nodes.size!==profile.nodes.length)throw Error("duplicate_cpu_node");
  for(const node of nodes.values())for(const child of node.children??[]){if(!nodes.has(child)||parents.has(child))throw Error("invalid_cpu_tree");parents.set(child,node.id);}
  const groups=new Map<string,{samples:number;sampled_elapsed_ms:number}>();
  for(const [i,id] of samples.entries()){
    let node=nodes.get(id);if(!node)throw Error("missing_cpu_node");
    let source:string|null=null;const visited=new Set<number>();
    while(node){if(visited.has(node.id))throw Error("cyclic_cpu_tree");visited.add(node.id);
      if(["(idle)","(garbage collector)","(program)"].includes(node.callFrame.functionName)){source=node.callFrame.functionName;break;}
      source=sourceFor(node.callFrame);if(source)break;const parent=parents.get(node.id);node=parent===undefined?undefined:nodes.get(parent);
    }
    const key=source??"unattributed/runtime",group=groups.get(key)??{samples:0,sampled_elapsed_ms:0};
    group.samples++;group.sampled_elapsed_ms+=deltas[i]!/1000;groups.set(key,group);
  }
  return {samples:samples.length,profile_elapsed_ms:(profile.endTime-profile.startTime)/1000,sampled_elapsed_ms:deltas.reduce((a,b)=>a+b,0)/1000,
    attribution:[...groups].map(([source,value])=>({source,...value})).sort((a,b)=>b.sampled_elapsed_ms-a.sampled_elapsed_ms),
    cpu_acceptance:false,semantics:"sampled elapsed-time attribution; idle/GC retained; not a billed CPU measurement"};
}
