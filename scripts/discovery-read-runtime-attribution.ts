// Offline analysis only. Five args: report, report SHA-256, bundle SHA-256,
// map SHA-256, NEW .tmp/output.json. Pins must come from the saved study.
import {readFileSync,lstatSync,realpathSync,writeFileSync} from "node:fs";
import {resolve,relative,isAbsolute,dirname,join} from "node:path";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import {z} from "zod";
import {RuntimeStudySchema,compareRuntimeStudies} from "./lib/discovery-read-runtime-comparison";
import {attributeRuntimeProfile,type SourcePosition} from "./lib/discovery-read-runtime-attribution";

const args=process.argv.slice(2),hex=/^[a-f0-9]{64}$/;
if(args.length!==5||args.slice(1,4).some(v=>!hex.test(v)))throw Error("report_three_saved_pins_and_new_output_required");
const root=realpathSync(resolve(".tmp"));
const inside=(path:string)=>{const name=relative(root,path);return name!==""&&!isAbsolute(name)&&name!==".."&&!name.startsWith("..\\")&&!name.startsWith("../");};
const sha=(value:Uint8Array|string)=>createHash("sha256").update(value).digest("hex");
const read=(path:string,max:number,expected?:string)=>{const requested=resolve(path),file=realpathSync(requested);if(!inside(file)||!lstatSync(requested).isFile()||lstatSync(file).size>max)throw Error("invalid_private_profile_input");
  const bytes=readFileSync(file),hash=sha(bytes);if(expected&&hash!==expected)throw Error("profile_input_pin_mismatch");return {path:relative(process.cwd(),file),sha256:hash,bytes};};
const input=read(args[0]!,2000000,args[1]),folder=dirname(resolve(args[0]!)),bundle=read(join(folder,"reader-runtime.mjs"),8000000,args[2]),sourceMap=read(join(folder,"reader-runtime.mjs.map"),16000000,args[3]);
const report=RuntimeStudySchema.parse(JSON.parse(input.bytes.toString("utf8")));compareRuntimeStudies(report,report); // Same strict fixture/guard coverage as comparisons.
const rawMap=z.object({version:z.literal(3),sources:z.string().max(8192).array().min(1).max(5000),sourcesContent:z.string().array().min(1).max(5000),
  names:z.string().array(),mappings:z.string()}).strict().parse(JSON.parse(sourceMap.bytes.toString("utf8")));
if(rawMap.sources.length!==rawMap.sourcesContent.length||new Set(rawMap.sources).size!==rawMap.sources.length)throw Error("invalid_embedded_sources");
const normalized=rawMap.sources.map(s=>s.replaceAll("\\","/")).map(s=>{for(const prefix of ["discovery/src/","scripts/lib/","node_modules/"]){const i=s.indexOf(prefix);if(i>=0)return s.slice(i);}return s;});
if(new Set(normalized).size!==normalized.length)throw Error("ambiguous_source_identity");
const sources=new Map(rawMap.sources.map((s,i)=>[s,{name:normalized[i]!,lines:rawMap.sourcesContent[i]!.split("\n")}])) ,generated=bundle.bytes.toString("utf8").split("\n");
const base=createRequire(new URL("../discovery/package.json",import.meta.url)),require=createRequire(base.resolve("wrangler/package.json"));
type Mapping={generatedLine:number;generatedColumn:number;source:string|null;originalLine:number|null;originalColumn:number|null};
const {TraceMap,originalPositionFor,eachMapping}=require("@jridgewell/trace-mapping") as {TraceMap:new(v:unknown)=>unknown;originalPositionFor:(m:unknown,p:{line:number;column:number})=>{source:string|null;line:number|null;column:number|null};eachMapping:(m:unknown,cb:(p:Mapping)=>void)=>void};
const map=new TraceMap(rawMap),lineMappings=new Map<number,SourcePosition[]>();
const point=(source:string|null,line:number|null,column:number|null):SourcePosition|null=>{if(source===null||line===null||column===null)return null;const original=sources.get(source);
  if(!original||!Number.isSafeInteger(line)||line<1||line>original.lines.length||!Number.isSafeInteger(column)||column<0||column>original.lines[line-1]!.length)throw Error("invalid_original_mapping");return {source:original.name,line,column};};
eachMapping(map,p=>{if(!Number.isSafeInteger(p.generatedLine)||p.generatedLine<1||p.generatedLine>generated.length||!Number.isSafeInteger(p.generatedColumn)||p.generatedColumn<0||p.generatedColumn>generated[p.generatedLine-1]!.length)throw Error("invalid_generated_mapping");
  const value=point(p.source,p.originalLine,p.originalColumn);if(value){const row=lineMappings.get(p.generatedLine)??[];row.push(value);lineMappings.set(p.generatedLine,row);}});
const mapping={frame:(line:number,column:number)=>{if(column>generated[line-1]!.length)throw Error("invalid_frame_column");const p=originalPositionFor(map,{line,column});return point(p.source,p.line,p.column);},line:(line:number)=>lineMappings.get(line)??[]};
const profiles=[];
for(const study of report.studies)for(const run of study.runs)if(run.kind==="profile")for(const entry of run.profiles){const file=read(join(folder,entry.artifact),16000000,entry.sha256),analysis=attributeRuntimeProfile(JSON.parse(file.bytes.toString("utf8")),generated.length,mapping);
  if(analysis.samples!==entry.samples||analysis.profile_elapsed_ms!==entry.profile_elapsed_ms||analysis.sampled_elapsed_ms!==entry.sampled_elapsed_ms||!analysis.frames.some(f=>f.original_function?.source.startsWith("discovery/src/")))throw Error("profile_report_accounting_mismatch");
  profiles.push({shape:study.shape,query:entry.query,requests:entry.requests,artifact:entry.artifact,sha256:file.sha256,...analysis});}
const output=resolve(args[4]!);if(!output.endsWith(".json")||!inside(output)||!inside(join(realpathSync(dirname(output)),"check.json")))throw Error("new_private_profile_output_required");
const provenance=[input,bundle,sourceMap].map(({path,sha256})=>({path,sha256})),embedded_sources=rawMap.sourcesContent.map((text,i)=>({source:normalized[i],sha256:sha(text)}));
writeFileSync(output,JSON.stringify({version:"full-reader-runtime-attribution-v1",provenance,embedded_sources,profiles,cpu_acceptance:false,promotion_authorized:false},null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({output:relative(process.cwd(),output),verified_profiles:profiles.length,embedded_sources:embedded_sources.length,cpu_acceptance:false,promotion_authorized:false}));
