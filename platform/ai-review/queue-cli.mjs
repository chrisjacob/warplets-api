import {readFileSync,statSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDatabase} from '../storage/database.mjs';
import {createNodeReviewQueueService} from './queue-service.mjs';

const usage=`Local durable review queue (paid providers disabled; never finalizes scores):
  node platform/ai-review/queue-cli.mjs capture --database PATH --operator-id ID --job-id submission:ID --input CAPTURE.json --evidence-ref REF
  node platform/ai-review/queue-cli.mjs run --database PATH --operator-id ID [--job-id ID]
  node platform/ai-review/queue-cli.mjs status --database PATH --wallet PUBLIC_ADDRESS --submission-id ID
Use an existing local database and a pre-existing active ai-review operator grant.
Capture files contain the exact seven normalizeJob fields. URLs are never fetched.
Only explicit .invalid / SYNTHETIC fixture captures can run. Real captures remain held.
Status is a trusted local operator inspection tool, not a wallet authentication endpoint.`;
export async function runQueueCli(args,{write=value=>console.log(JSON.stringify(value))}={}){
 if(!args.length||args[0]==='--help'){console.log(usage);return;}
 const [command,...rest]=args,options={},allowed={capture:['database','operator-id','job-id','input','evidence-ref'],run:['database','operator-id','job-id'],status:['database','wallet','submission-id']};
 if(!allowed[command])throw new Error('Unknown queue command. Use --help.');
 for(let i=0;i<rest.length;i+=2){const flag=rest[i],value=rest[i+1],key=flag?.slice(2);if(!flag?.startsWith('--')||!allowed[command].includes(key)||Object.hasOwn(options,key)||!value||value.startsWith('--'))throw new Error('Invalid, repeated or incomplete queue option.');options[key]=value;}
 const required=allowed[command].filter(key=>command!=='run'||key!=='job-id');
 if(required.some(key=>!options[key]))throw new Error('Missing queue option. Use --help.');
 const path=resolve(options.database);if(!existsSync(path)||!statSync(path).isFile())throw new Error('Use an existing local database file.');
 let job;
 if(command==='capture'){if(statSync(options.input).size>131072)throw new Error('Capture exceeds 128 KiB.');const bytes=readFileSync(options.input);if(bytes.byteLength>131072)throw new Error('Capture exceeds 128 KiB.');job=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));}
 const db=openDatabase(path);
 try{
  const service=createNodeReviewQueueService(db),principal={kind:'operator',id:options['operator-id']};
  const result=command==='capture'?service.capture(principal,{jobId:options['job-id'],job,evidenceRef:options['evidence-ref']}):command==='run'?await service.runOne(principal,{jobId:options['job-id']}):service.walletStatus({kind:'wallet',wallet:options.wallet},options['submission-id']);
  write(result);return result;
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runQueueCli(process.argv.slice(2)).catch(error=>{console.error(error.code??'queue_command_failed');process.exitCode=1;});
