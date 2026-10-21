import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {closeSync,existsSync,fsyncSync,lstatSync,openSync,readFileSync,realpathSync,writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {activityCoverageAudit,verifyActivityCoverage} from "../discovery/src/activity-coverage-audit";

const MAX_BYTES=32_000_000;
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
function regularFile(file:string){const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw Error("audit_regular_file_required");return stat;}
function privateOutput(file:string){
  const privateDirectory=fileURLToPath(new URL("../.tmp/",import.meta.url));
  if(lstatSync(privateDirectory).isSymbolicLink())throw Error("audit_private_directory_must_not_be_linked");
  const directory=realpathSync(privateDirectory);
  const parent=realpathSync(path.dirname(path.resolve(file))),relative=path.relative(directory,parent);
  if(relative===".."||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||parent.split(/[\\/]/).some(part=>part.toLowerCase()===".wrangler"))throw Error("audit_output_must_be_inside_private_tmp");
  const destination=path.join(parent,path.basename(file));
  if(existsSync(destination))throw Error("audit_output_already_exists");
  return destination;
}
export async function exportCoverageAudit(database:string,output:string){
  regularFile(database);const destination=privateOutput(output),sqlite=new DatabaseSync(database,{readOnly:true});
  let audit;
  try{
    sqlite.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=10000; BEGIN");
    // Establish one WAL read snapshot, then use a single cutoff for every row.
    sqlite.prepare("SELECT count(*) FROM tenx_candidates").get();
    audit=await activityCoverageAudit(sqliteD1(sqlite),new Date(),performance.now()+120000);
    if(sqlite.prepare("SELECT total_changes() AS n").get()!.n!==0)throw Error("audit_database_write_detected");
  }finally{sqlite.close();}
  const bytes=Buffer.from(JSON.stringify(audit)+"\n");
  if(bytes.length>MAX_BYTES)throw Error("audit_export_byte_bound");
  const file=openSync(destination,"wx",0o600);
  try{writeFileSync(file,bytes);fsyncSync(file);}finally{closeSync(file);}
  return {file:destination,sha256:digest(bytes),bytes:bytes.length,summary:audit.summary};
}
export async function verifyCoverageAudit(file:string,expected:string){
  if(!/^[a-f0-9]{64}$/.test(expected))throw Error("audit_pinned_sha256_required");
  if(regularFile(file).size>MAX_BYTES)throw Error("audit_export_byte_bound");
  const bytes=readFileSync(file);if(bytes.length>MAX_BYTES||digest(bytes)!==expected)throw Error("audit_file_checksum_mismatch");
  const audit=await verifyActivityCoverage(JSON.parse(bytes.toString("utf8")));
  return {sha256:expected,bytes:bytes.length,summary:audit.summary};
}
async function main(args:string[]){
  let result;
  if(args.length===5&&args[0]==="export"&&args[1]==="--database"&&args[3]==="--output")result=await exportCoverageAudit(args[2]!,args[4]!);
  else if(args.length===5&&args[0]==="verify"&&args[1]==="--file"&&args[3]==="--sha256")result=await verifyCoverageAudit(args[2]!,args[4]!);
  else throw Error("Usage: discovery-coverage-audit.ts export --database FILE --output .tmp/NEW.json | verify --file FILE --sha256 PINNED_SHA256");
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main(process.argv.slice(2)).catch(()=>{
  // No source payloads, wallet addresses or credentials in exception output.
  console.error("Coverage audit failed. Check command arguments, input integrity, private output location and inventory bounds; no counters or source evidence were changed.");process.exitCode=1;
});
