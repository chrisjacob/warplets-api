import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {existsSync,lstatSync,readFileSync,realpathSync,writeFileSync} from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {sqliteD1} from "../app/functions/_lib/sqliteTestDb";
import {discoveryYield} from "../discovery/src/discovery-yield";
import {DiscoveryYield} from "../discovery/src/discovery-yield-model";
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
export async function exportDiscoveryYield(database:string,output:string){
  if(!lstatSync(database).isFile()||lstatSync(database).isSymbolicLink())throw Error('yield_regular_database_required');
  const root=realpathSync('.tmp'),parent=realpathSync(path.dirname(path.resolve(output))),relative=path.relative(root,parent);
  if(lstatSync('.tmp').isSymbolicLink()||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||existsSync(output))throw Error('yield_new_private_output_required');
  const sqlite=new DatabaseSync(database,{readOnly:true});let report;const started=performance.now();
  try{sqlite.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=10000');report=await discoveryYield(sqliteD1(sqlite));if(sqlite.prepare('SELECT total_changes() n').get()!.n!==0)throw Error('yield_database_changed');}finally{sqlite.close();}
  const bytes=Buffer.from(JSON.stringify({version:1,scope:'native_read_only_aggregate_snapshot',wall_ms:performance.now()-started,remote_cpu_or_billing_certified:false,report},null,2)+'\n');
  writeFileSync(output,bytes,{flag:'wx',mode:0o600});return {file:path.resolve(output),sha256:sha(bytes),report};
}
export function verifyDiscoveryYield(file:string,pin:string){
  if(!/^[a-f0-9]{64}$/.test(pin)||!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()||lstatSync(file).size>100000)throw Error('yield_small_pinned_report_required');
  const bytes=readFileSync(file);if(sha(bytes)!==pin)throw Error('yield_pin_mismatch');const saved=JSON.parse(bytes.toString('utf8'));
  if(saved.version!==1||saved.scope!=='native_read_only_aggregate_snapshot'||saved.remote_cpu_or_billing_certified!==false)throw Error('yield_report_scope_mismatch');return DiscoveryYield.parse(saved.report);
}
async function main(args:string[]){
  if(args.length===5&&args[0]==='export'&&args[1]==='--database'&&args[3]==='--output')console.log(JSON.stringify(await exportDiscoveryYield(args[2]!,args[4]!),null,2));
  else if(args.length===5&&args[0]==='verify'&&args[1]==='--file'&&args[3]==='--sha256')console.log(JSON.stringify(verifyDiscoveryYield(args[2]!,args[4]!),null,2));
  else throw Error('yield_arguments_invalid');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main(process.argv.slice(2)).catch(()=>{console.error('Discovery yield audit held. Check explicit input/output, schema and report pin. No provider request, evidence or allowance was changed.');process.exitCode=1;});
