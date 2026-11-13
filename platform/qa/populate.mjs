import {mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,dirname,basename,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {buildPerformanceScenario,DEFAULT_QA_OWNER} from './scenario.mjs';
import {seedCoreScenario} from './core.mjs';
import {alignOwnerRewards} from './core-rewards.mjs';
import {createPerformanceService} from '../performance/leaderboards.mjs';
export function populateQa({directory,wallet=DEFAULT_QA_OWNER,seed='three-month-v1',asOf,participantCount=250,mintCountPerSeason=60,missingPrices=false}={}){
 if(typeof directory!=='string'||!directory.trim())throw Error('Supply an explicit new --directory with a qa- prefix.');
 const target=resolve(directory);if(!basename(target).startsWith('qa-'))throw Error('The output directory name must start qa-.');
 if(existsSync(target))throw Error('Refusing to overwrite an existing QA directory: '+target);
 const snapshot=buildPerformanceScenario({wallet,seed,asOf,participantCount,missingPrices});let text=JSON.stringify(snapshot);
 if(Buffer.byteLength(text)>10*1024*1024)throw Error('QA snapshot exceeds 10 MiB bound; reduce participant count.');
 mkdirSync(dirname(target),{recursive:true});mkdirSync(target);
 const db=openDatabase(join(target,'core.sqlite'));
 try{
  const core=seedCoreScenario(db,snapshot,{wallet,seed,mintCountPerSeason});
  const ownerAlignment=alignOwnerRewards(db,snapshot,wallet);text=JSON.stringify(snapshot);
  if(Buffer.byteLength(text)>10*1024*1024)throw Error('Aligned QA snapshot exceeds 10 MiB bound; reduce participant count.');
  const service=createPerformanceService(snapshot),candidate=snapshot.participants.at(-4).wallet,outside=service.board('airdrops',{wallet:candidate}).myRank;
  if(!outside||outside.rank<=100)throw Error('QA outside-top-100 example was not preserved.');
  writeFileSync(join(target,'performance.json'),text);
  const report={schemaVersion:1,scope:'synthetic-local-only',status:'complete',seed,asOf:snapshot.asOf,wallet,pricing:missingPrices?'gaps':'complete',performance:{tokens:snapshot.tokens.length,participants:snapshot.participants.length,rewards:snapshot.rewards.length,bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')},core,ownerAlignment,examples:{outsideTop100:{wallet:candidate,peakRank:outside.rank},...(missingPrices?{missingPriceToken:snapshot.tokens.at(-1).id,stalePriceToken:snapshot.tokens.at(-2).id}:{})},financialExecution:false,important:'Selected owner reward quantities match core fixture readers as of the snapshot timestamp. Live demo vesting continues afterward. Other participants are a separate synthetic history projection, not executable core ledger balances. Never sum the datasets. All prices, ownership and rewards are synthetic; no real funds or external traffic.'};
  writeFileSync(join(target,'scenario.json'),JSON.stringify(report,null,2)+'\n');
  writeFileSync(join(target,'README.txt'),'SYNTHETIC LOCAL QA ONLY\n'+report.important+'\nStart: node platform/qa/serve.mjs --directory "'+target+'"\n');
  return report;
 }catch(error){writeFileSync(join(target,'FAILED.txt'),'Incomplete synthetic QA scenario; do not serve.\n'+error.message);throw error;}finally{db.close();}
}
export function parseArgs(args){const allowed=new Set(['directory','wallet','seed','as-of','participants','port','origin','pricing']),options={};for(let i=0;i<args.length;i+=2){const k=args[i]?.replace(/^--/,'');if(!args[i]?.startsWith('--')||!allowed.has(k)||!args[i+1]||Object.hasOwn(options,k))throw Error('Unknown, missing or repeated QA option.');options[k]=args[i+1];}if(options.pricing&&!['complete','gaps'].includes(options.pricing))throw Error('Use --pricing complete or gaps.');return options;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const a=parseArgs(process.argv.slice(2));const report=populateQa({directory:a.directory,wallet:a.wallet,seed:a.seed,asOf:a['as-of'],participantCount:a.participants===undefined?undefined:Number(a.participants),missingPrices:a.pricing==='gaps'});console.log(JSON.stringify(report,null,2));}
