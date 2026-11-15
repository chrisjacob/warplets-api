import {readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openDatabase} from '../storage/database.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {readSupportedPost,createPostCapture} from '../earn/post-source.mjs';
import {createNodeReviewQueueService} from './queue-service.mjs';

/** Trusted local operator command. No model calls, automatic scores or URL proxy. */
export async function capturePublicPost({database,operatorId,jobId,contextFile,receiptFile},{fetcher=fetch,clock={nowMs:Date.now}}={}){
 if(!database||!operatorId||!jobId||!contextFile||!receiptFile)throw Error('Supply database, operator, job, context and new receipt file.');
 if(!existsSync(database)||!statSync(database).isFile()||existsSync(receiptFile))throw Error('Use an existing database and a new receipt file.');
 if(statSync(contextFile).size>32000)throw Error('Project context is too large.');const projectContext=readFileSync(contextFile,'utf8').trim();if(!projectContext||projectContext.length>8000)throw Error('Supply bounded trusted project context.');
 const db=openDatabase(database),crypto=createNodeCrypto();try{
  if(!db.prepare("SELECT 1 FROM app_operator_scopes WHERE operator=? AND scope='ai-review' AND enabled=1").get(operatorId))throw Error('An active ai-review operator grant is required.');
  const row=db.prepare("SELECT s.* FROM ai_review_jobs j JOIN earn_submissions s ON s.id=j.submission_id WHERE j.id=? AND j.state='awaiting-capture'").get(jobId);if(!row)throw Error('The job is not awaiting a capture.');
  const source=await readSupportedPost(row.url,{fetcher,crypto,clock,requireCompleteText:true});
  if(!source.textComplete||source.hasMedia)throw Error('This source exposes an excerpt or attached media. A complete authorized text/transcript capture is required; no review was queued.');
  const capture=await createPostCapture({submission:row,projectContext,source,crypto,nowMs:clock.nowMs()}),receipt={format:'10x.public-post-capture.v1',...capture.receipt,jobId,submissionId:row.id,inputHash:await crypto.sha256(utf8(canonicalJson(capture.job))),operatorId};
  // Retain the receipt even if a concurrent closure/revocation refuses admission.
  // Never overwrite an earlier source receipt or truncate captured text.
  writeFileSync(receiptFile,canonicalJson(receipt)+'\n',{flag:'wx'});
  return await createNodeReviewQueueService(db,{clock}).capture({kind:'operator',id:operatorId},{jobId,job:capture.job,evidenceRef:capture.evidenceRef});
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const fields={'--database':'database','--operator-id':'operatorId','--job-id':'jobId','--context':'contextFile','--receipt':'receiptFile'},args=process.argv.slice(2),options={};
 for(let n=0;n<args.length;n+=2){const key=fields[args[n]],value=args[n+1];if(!key||!value||value.startsWith('--')||options[key])throw Error('Use --database PATH --operator-id ID --job-id ID --context FILE --receipt NEW_FILE.');options[key]=value;}
 capturePublicPost(options).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
