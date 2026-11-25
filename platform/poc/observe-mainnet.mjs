import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {readAccounts} from '../lab/refresh-kamino.mjs';
import {inspectUpgradeableDeployment} from '../lab/kamino.mjs';

if(process.argv.length!==4||process.argv[2]!=='--read-public-accounts')throw Error('Use --read-public-accounts <new-evidence-directory>.');
const output=resolve(process.argv[3]);
if(existsSync(output))throw Error('Refusing to overwrite an evidence directory.');
mkdirSync(output,{recursive:true});
const rpc='https://api.mainnet-beta.solana.com';
const expectedGenesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const report={schemaVersion:1,evidenceClass:'read-only-mainnet',rpc,startedAt:new Date().toISOString(),commitment:'finalized',transactionsSubmitted:0,spentUsd:0,sourceMatchVerified:false,programs:[],errors:[]};
async function read(method,params=[]){
 if(!['getGenesisHash','getSlot','getMinimumBalanceForRentExemption'].includes(method))throw Error('Read method not allowlisted.');
 const response=await fetch(rpc,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 if(!response.ok)throw Error('Public RPC HTTP '+response.status);
 const content=await response.text();if(content.length>32768)throw Error('RPC response exceeds bound.');
 const body=JSON.parse(content);if(body.error||body.result===undefined)throw Error('Public RPC rejected '+method);
 return body.result;
}
try{
 report.genesis=await read('getGenesisHash');
 if(report.genesis!==expectedGenesis)throw Error('Unexpected genesis; stop mainnet observations.');
 report.slot=await read('getSlot',[{commitment:'finalized'}]);
 if(!Number.isSafeInteger(report.slot)||report.slot<1)throw Error('Invalid finalized slot.');
 const paths=['meteora-deployment-observation.json','kamino-public.json','rewards-program.json','core-program.json'];
 const expected=paths.map(name=>{
  const value=JSON.parse(readFileSync(new URL('../lab/fixtures/'+name,import.meta.url)));
  return {name,baseline:value.deployment??value};
 });
 const addresses=expected.flatMap(({baseline:b})=>[b.program,b.programData]);
 const raw=await readAccounts(addresses,report.slot);
 report.accountResponseSha256=createHash('sha256').update(JSON.stringify(raw)).digest('hex');
 for(let i=0;i<expected.length;i++){
  const {name,baseline}=expected[i];
  const pair={...raw,addresses:addresses.slice(i*2,i*2+2),accounts:raw.accounts.slice(i*2,i*2+2)};
  const observed=inspectUpgradeableDeployment(pair,baseline.program,baseline.programData);
  const fields=['allocatedElfSha256','deployedSlot','upgradeAuthority','programDataLength'];
  report.programs.push({name,observed,baselineObservedAt:baseline.observedAt??null,comparison:fields.map(field=>({field,expected:baseline[field],observed:observed[field],matches:baseline[field]===observed[field]}))});
 }
 report.rent={};
 for(const bytes of [82,165])report.rent[bytes]=await read('getMinimumBalanceForRentExemption',[bytes,{commitment:'finalized'}]);
 report.rentScope='Classic 82-byte mint and 165-byte token account only; not an all-in launch quote or Token-2022/Core estimate.';
 report.programParity=report.programs.every(p=>p.comparison.every(c=>c.matches));
}catch(error){report.errors.push(error.message);report.programParity=null;}
report.finishedAt=new Date().toISOString();
writeFileSync(join(output,'observation.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
process.exitCode=report.errors.length?1:0;
