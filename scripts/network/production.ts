// Explicit operator-only runner for the existing production Network namespace.
// Uses the same importers, leases and quota ledgers as the scheduled Worker.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { advanceNetwork } from '../../app/functions/_lib/network/ingest';
import { importWalletAssociations, importWalletBatch, refreshWalletPrices } from '../../app/functions/_lib/network/wallets';
import { importNetworkActivity } from '../../app/functions/_lib/network/activity';
import { publishSnapshot, syncGet, type NetworkEnv } from '../../app/functions/_lib/network/store';
import { NETWORK_CURRENT_COHORT } from '../../app/functions/_lib/network/cohort';
import { NETWORK_RECORD_REFRESH_MS } from '../../app/shared/network/refresh';

const root=resolve(import.meta.dirname,'../..');
if(!process.argv.includes('--remote'))throw Error('Explicit --remote is required; this runner updates production Network data');
const config=readFileSync(resolve(root,'wrangler.toml'),'utf8');
const account=config.match(/^account_id\s*=\s*"([a-f0-9]{32})"/m)?.[1];
const database=config.match(/^database_id\s*=\s*"([a-f0-9-]{36})"/m)?.[1];
if(account!=='3f3a7e7d6b29f0389b841af63623becd'||database!=='45a4cc4c-788e-48dd-89bf-7b504b17655d')throw Error('Unexpected production target');
const oauthFile=resolve(process.env.APPDATA??'', 'xdg.config/.wrangler/config/default.toml');
function token(){return process.env.CLOUDFLARE_API_TOKEN??readFileSync(oauthFile,'utf8').match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];}
type Statement={sql:string;params:(string|number|null)[]};
let nextQueryAt=0;
function literal(value:string|number|null){if(value===null)return 'NULL';if(typeof value==='number'){if(!Number.isFinite(value))throw Error('Non-finite SQL value');return String(value);}return "'"+value.replaceAll("'","''")+"'";}
function inline({sql,params}:Statement,encode=literal){let index=0;const result=sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g,part=>{if(part!=='?')return part;if(index>=params.length)throw Error('SQL binding count mismatch');return encode(params[index++]);});if(index!==params.length)throw Error('SQL binding count mismatch');return result;}
async function query(statements:Statement[],retry=true):Promise<D1Result[]> {
 let body:Statement;
 if(statements.length===1)body=statements[0];
 else{
  const sql=statements.map(s=>inline(s)).join(';\n');
  if(Buffer.byteLength(sql)>80_000){
   // REST accepts bindings for one statement only. Stage large values privately,
   // then reference them from the same atomic multi-statement request. Verified
   // rollback leaves original state intact when any statement fails.
   const key='operator:parameters:'+crypto.randomUUID(),params=statements.flatMap(s=>s.params);
   await query([{sql:'INSERT INTO network_sync(key,value,updated_at) VALUES(?,?,?)',params:[key,JSON.stringify(params),Date.now()]}]);
   let index=0;
   try{return await query([{sql:statements.map(s=>inline(s,()=>`(SELECT json_extract(value,'$[${index++}]') FROM network_sync WHERE key=${literal(key)})`)).join(';\n'),params:[]}],retry);}
   finally{await query([{sql:'DELETE FROM network_sync WHERE key=?',params:[key]}]);}
  }
  body={sql,params:[]};
 }
 // Operator REST traffic must leave room for the public app and scheduled jobs.
 const startAt=Math.max(Date.now(),nextQueryAt);nextQueryAt=startAt+250;
 if(startAt>Date.now())await new Promise(resolve=>setTimeout(resolve,startAt-Date.now()));
 const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`,{
  method:'POST',redirect:'error',headers:{authorization:`Bearer ${token()}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90_000),
 });
 if((response.status===401||response.status===403)&&retry&&!process.env.CLOUDFLARE_API_TOKEN){
  await response.body?.cancel();
  const refresh=spawnSync(process.execPath,[resolve(root,'app/node_modules/wrangler/bin/wrangler.js'),'whoami'],{cwd:root,stdio:'ignore',windowsHide:true});
  if(refresh.status===0)return query(statements,false);
 }
 const payload=await response.json() as {success:boolean;result:D1Result[];errors?:{code:number;message:string}[]};
 if(!response.ok||!payload.success||payload.result.some(r=>!r.success))throw Error(`Production D1 query failed (${response.status}; ${payload.errors?.[0]?.code??'query'}): ${payload.errors?.[0]?.message??'No details'}`);
 return payload.result;
}
function prepare(sql:string){
 const statement:Statement={sql,params:[]};
 return {...statement,bind(...params:Statement['params']){this.params=params;return this;},
 async all(){return (await query([{sql:this.sql,params:this.params}]))[0];},
 async run(){return this.all();},
 async first(column?:string){const r=(await this.all()).results[0] as Record<string,unknown>|undefined;return r?(column?r[column]:r):null;}};
}
const db={prepare,async batch(statements:ReturnType<typeof prepare>[]){return query(statements.map(({sql,params})=>({sql,params})));}} as unknown as D1Database;
const secrets={...process.env};
for(const file of ['.dev.vars','app/.dev.vars'])try{for(const line of readFileSync(resolve(root,file),'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);if(m&&!secrets[m[1]])secrets[m[1]]=m[2].trim().replace(/^(["'])(.*)\1$/,'$2');}}catch{}
const vars=config.split(/^\[vars\]\s*$/m)[1]?.split(/^\[/m)[0]??'';
const setting=(key:string)=>vars.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`,'m'))?.[1];
const env:NetworkEnv={WARPLETS:db,NETWORK_INGEST_ENABLED:'true',NETWORK_WALLETS_ENABLED:'true',NEYNAR_API_KEY:secrets.NEYNAR_API_KEY,ALCHEMY_API_KEY:secrets.ALCHEMY_API_KEY,
 NETWORK_NEYNAR_PRICING_ENABLED:setting('NETWORK_NEYNAR_PRICING_ENABLED'),
 NETWORK_ACTIVITY_BATCH:setting('NETWORK_ACTIVITY_BATCH'),NETWORK_RPC_URL:setting('NETWORK_RPC_URL'),NETWORK_SCAN_BLOCKS:setting('NETWORK_SCAN_BLOCKS'),NETWORK_WALLET_CREDITS:setting('NETWORK_WALLET_CREDITS'),NETWORK_REQUESTS_PER_DAY:setting('NETWORK_REQUESTS_PER_DAY'),NETWORK_REQUESTS_PER_MONTH:setting('NETWORK_REQUESTS_PER_MONTH'),NETWORK_ALCHEMY_CU:setting('NETWORK_ALCHEMY_CU'),NETWORK_ALCHEMY_CU_PER_DAY:setting('NETWORK_ALCHEMY_CU_PER_DAY'),NETWORK_PROFILE_BATCH:'100',NETWORK_SCAN_BATCH:'100'};
const task=process.argv.find(a=>a.startsWith('--task='))?.slice(7)??'status';
const steps=Number(process.argv.find(a=>a.startsWith('--steps='))?.slice(8)??1);
if(!Number.isSafeInteger(steps)||steps<1||steps>1000)throw Error('steps must be 1..1000');
if(task==='profiles'&&process.argv.includes('--retry-failures'))await db.prepare('UPDATE network_profile_failures SET retry_after=0').run();
if(task==='status'){
 const queries={
 sync:"SELECT key,value FROM network_sync WHERE key NOT LIKE 'bootstrap:%' AND key NOT LIKE 'operator:parameters:%' AND key<>'neynar_pricing'",
 pricing:"SELECT json_extract(value,'$.at') verifiedAt FROM network_sync WHERE key='neynar_pricing'",
 profiles:`SELECT COUNT(*) total,MIN(p.observed_at) oldest,SUM(p.observed_at<?) stale FROM network_profiles p WHERE p.fid IN (${NETWORK_CURRENT_COHORT})`,
 associations:`SELECT COUNT(*) total,SUM(a.fid IS NULL) missing,SUM(a.observed_at<?) stale FROM (${NETWORK_CURRENT_COHORT}) c LEFT JOIN network_wallet_associations a ON a.fid=c.fid`,
 wallets:`SELECT COUNT(*) expected,SUM(v.address IS NULL) missing,SUM(v.observed_at<?) stale FROM (SELECT DISTINCT l.address FROM network_wallet_links l JOIN (${NETWORK_CURRENT_COHORT}) c ON c.fid=l.fid) l LEFT JOIN network_wallet_values v ON v.address=l.address`,
 credits:'SELECT * FROM network_credit_budgets ORDER BY month DESC LIMIT 2',
 activity:'SELECT (SELECT COUNT(*) FROM network_activity_months) observed,(SELECT COUNT(*) FROM network_activity_checks) checked',
 };
 for(const [key,sql]of Object.entries(queries)){const params=['profiles','associations','wallets'].includes(key)?[Date.now()-NETWORK_RECORD_REFRESH_MS]:[];console.log(JSON.stringify({[key]:(await query([{sql,params}]))[0].results}));}
}else for(let i=0;i<steps;i++){
 let result:unknown;
 if(task==='profiles'||task==='scan')result=await advanceNetwork(env,{profilesOnly:task==='profiles',scanOnly:task==='scan'});
 else if(task==='associations')result={saved:await importWalletAssociations(env)};
 else if(task==='wallets')result=await importWalletBatch(env,25,4);
 else if(task==='activity')result=await importNetworkActivity(env);
 else if(task==='publish')result={snapshot:(await publishSnapshot(db,true))?.id};
 else if(task==='prices'){await refreshWalletPrices(env);result={status:'refreshed'};}
 else throw Error('Unknown task');
 console.log(JSON.stringify({step:i+1,task,result}));
 const status=(result as {status?:string})?.status;
 if(status==='busy'&&process.argv.includes('--wait')){await new Promise(resolve=>setTimeout(resolve,15000));i--;continue;}
 if(['busy','complete','unavailable','cooldown','waiting'].includes(status??''))break;
 if(task==='scan'){const scan=await syncGet(db,'scan',{block:0,target:1});console.log(JSON.stringify({scan}));if(scan.block>=scan.target)break;}
 if(task==='associations'&&(result as {saved:number}).saved===0)break;
 if(task==='profiles'&&(result as {profilesSaved:number}).profilesSaved===0)break;
}
