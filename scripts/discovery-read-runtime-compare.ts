// Read-only comparison of local runtime reports. Output is a new ignored file.
// pnpm exec tsx scripts/discovery-read-runtime-compare.ts .tmp/before/report.json .tmp/after/report.json .tmp/comparison-NEW.json
import {readFileSync,lstatSync,realpathSync,writeFileSync} from "node:fs";
import {resolve,relative,isAbsolute,dirname,join} from "node:path";
import {createHash} from "node:crypto";
import {RuntimeStudySchema,compareRuntimeStudies} from "./lib/discovery-read-runtime-comparison";
const root=realpathSync(resolve(".tmp")),args=process.argv.slice(2);
if(args.length!==3)throw Error("before_after_and_new_private_json_required");
const inside=(path:string)=>{const name=relative(root,path);return name!==""&&!isAbsolute(name)&&name!==".."&&!name.startsWith("..\\")&&!name.startsWith("../");};
const read=(path:string,maximum:number)=>{const file=realpathSync(resolve(path));if(!inside(file)||!lstatSync(resolve(path)).isFile()||lstatSync(file).size>maximum)throw Error("invalid_private_evidence_file");return {file,bytes:readFileSync(file)};};
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const before=read(args[0]!,2000000),after=read(args[1]!,2000000),inputs=[before,after].map(input=>({path:relative(process.cwd(),input.file),sha256:sha(input.bytes)}));
const first=RuntimeStudySchema.parse(JSON.parse(before.bytes.toString("utf8"))),second=RuntimeStudySchema.parse(JSON.parse(after.bytes.toString("utf8")));
const comparison=compareRuntimeStudies(first,second),profiles=[];
for(const [index,report] of [first,second].entries())for(const study of report.studies)for(const run of study.runs)if(run.kind==="profile")for(const p of run.profiles){
  const input=index===0?before:after,file=read(join(dirname(input.file),p.artifact),16000000);
  if(sha(file.bytes)!==p.sha256)throw Error("profile_artifact_hash_mismatch");
  profiles.push({input:index,shape:study.shape,artifact:p.artifact,sha256:p.sha256});
}
const output=resolve(args[2]!);
if(!output.endsWith(".json")||!inside(output)||!inside(join(realpathSync(dirname(output)),"check.json")))throw Error("new_private_json_output_required");
const result={...comparison,inputs,profiles};writeFileSync(output,JSON.stringify(result,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({comparison:relative(process.cwd(),output),fixtures:comparison.studies.length,queries:comparison.studies.reduce((n,s)=>n+s.cases.length,0),verified_profile_artifacts:profiles.length,cpu_acceptance:false,promotion_authorized:false}));
