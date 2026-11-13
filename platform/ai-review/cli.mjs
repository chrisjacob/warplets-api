import {readFileSync,writeFileSync,statSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {evaluateSubmission,creatorFeedback,createAppeal,verifyReport,draftFinalReviewInput,draftOperatorRequest} from './review.mjs';
import {createOpenAIProvider} from './openai-provider.mjs';
import {syntheticProvider,exampleJob} from './fixture.mjs';
const usage=`Local review tools (only explicit openai mode can call a paid provider; never writes the app database):
  node platform/ai-review/cli.mjs example --out work/ai-job.json
  node platform/ai-review/cli.mjs fixture --input work/ai-job.json --out work/ai-report.json
  node platform/ai-review/cli.mjs import --input work/ai-job.json --response work/model-output.json --provider provider-id --model model-version --out work/ai-report.json
  node platform/ai-review/cli.mjs openai --allow-paid-provider --input work/ai-job.json --model APPROVED_MODEL_ID --out work/model-report.json
  node platform/ai-review/cli.mjs feedback --input work/ai-report.json --out work/ai-feedback.json
  node platform/ai-review/cli.mjs appeal --input work/ai-report.json --reason-file work/appeal.txt --out work/ai-appeal.json
  node platform/ai-review/cli.mjs draft --input work/ai-report.json --accept-suggestion --allow-simulation --out work/ai-review-input.json
  node platform/ai-review/cli.mjs request --input work/ai-report.json --revisions work/current-revisions.json --accept-suggestion --allow-simulation --out work/operator-request.json
Outputs are created exclusively; existing files are never overwritten. Imported provenance is unverified. Drafts require the normal authorized operator review flow.`;
function read(path,json=true){if(!path)throw Error('Missing input path.');const size=statSync(path).size;if(size>131072)throw Error('Input exceeds 128 KiB.');const raw=readFileSync(path,'utf8').replace(/^\uFEFF/,'');return json?JSON.parse(raw):raw.trim();}
function write(path,value){if(!path)throw Error('Specify --out.');writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',encoding:'utf8',mode:0o600});}
export async function run(args){
 if(!args.length||args[0]==='--help'){console.log(usage);return;}
 const [command,...rest]=args,options={};const switches=new Set(['accept-suggestion','allow-simulation','allow-paid-provider']);
 for(let i=0;i<rest.length;i++){const flag=rest[i];if(!flag.startsWith('--')||Object.hasOwn(options,flag.slice(2)))throw Error('Invalid or repeated option.');const key=flag.slice(2);options[key]=switches.has(key)?true:rest[++i];if(options[key]===undefined)throw Error('Missing option value.');}
 const allowed={example:['out'],fixture:['input','out','previous','appeal'],import:['input','response','provider','model','out','previous','appeal'],openai:['input','model','out','previous','appeal','allow-paid-provider','max-output-tokens'],feedback:['input','out'],appeal:['input','reason-file','out'],draft:['input','out','accept-suggestion','allow-simulation'],request:['input','out','revisions','accept-suggestion','allow-simulation']};
 if(!allowed[command]||Object.keys(options).some(k=>!allowed[command].includes(k)))throw Error('Unknown command or option. Use --help.');
 if(!options.out)throw Error('Specify --out.');
 if(existsSync(options.out))throw Error('Output already exists; no evaluation was started.');
 let result;
 if(command==='example')result=exampleJob;
 else if(command==='feedback')result=creatorFeedback(read(options.input));
 else if(command==='appeal')result=createAppeal({report:read(options.input),reason:read(options['reason-file'],false),createdAt:new Date().toISOString()});
 else if(command==='request')result=draftOperatorRequest(read(options.input),{decision:options['accept-suggestion']?'accept-suggestion':null,allowSimulation:options['allow-simulation']===true,expectedRevisions:read(options.revisions)});
 else if(command==='draft')result=draftFinalReviewInput(read(options.input),{decision:options['accept-suggestion']?'accept-suggestion':null,allowSimulation:options['allow-simulation']===true});
 else{
  if(command==='openai'&&options['allow-paid-provider']!==true)throw Error('OpenAI scoring requires explicit --allow-paid-provider consent.');
  const job=read(options.input),provider=command==='fixture'?syntheticProvider:command==='openai'?createOpenAIProvider({apiKey:process.env.OPENAI_API_KEY,model:options.model??process.env.OPENAI_REVIEW_MODEL,allowPaidProvider:true,maxOutputTokens:options['max-output-tokens']===undefined?4096:Number(options['max-output-tokens'])}):{id:options.provider,model:options.model,version:'import-v1',kind:'model',provenance:'operator-import',evaluate:async()=>read(options.response)};
  result=await evaluateSubmission({job,provider,timeoutMs:command==='openai'?60000:30000,previousReport:options.previous?verifyReport(read(options.previous)):null,appeal:options.appeal?read(options.appeal):null});
 }
 write(options.out,result);console.log(JSON.stringify({output:options.out,kind:result.payload?.kind??command,simulation:result.payload?.simulation??result.simulation??command==='example',financialExecution:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
