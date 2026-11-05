// Synthetic B20 fixtures: generated message-only wallets, no funded keys or provider calls.
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {openDatabase} from '../../storage/database.mjs';
import {encode58} from '../../server/base58.mjs';
import {recordSamplePrice} from '../../pricing/fixtures.mjs';
import {configureWorkload} from '../../earn/operations.mjs';
import {configureAction,recordActionCompletion} from '../../earn/components.mjs';
import {importMarket} from '../../markets/catalog.mjs';
import {verifyHostedTranscript} from './hosted-transcript.mjs';
import {createClient} from '../../contracts/client.mjs';
export const HOSTED_DAY=86400000;
export const HOSTED_PRINCIPAL=Object.freeze({kind:'operator',id:'synthetic-hosted-operator'});
const key=n=>encode58(Buffer.alloc(32,n));
export async function createHostedSlice(runtime,{nowMs=Math.floor(Date.now()/1000)*1000}={}){
 const epoch=Math.floor(nowMs/HOSTED_DAY),start=epoch*HOSTED_DAY,cutoff=start+HOSTED_DAY-1,activation=start-HOSTED_DAY+3600000;
 const accounts=['fallback-contributor','positive-contributor','rejected-contributor','browser-contributor'].map(label=>{
  const pair=generateKeyPairSync('ed25519'),publicKeyBytes=[...pair.publicKey.export({type:'spki',format:'der'}).subarray(-32)];
  return {...pair,publicKeyBytes,wallet:encode58(new Uint8Array(publicKeyBytes)),label};
 });
 const seed=openDatabase();
 try{
  for(const scope of ['jobs-runner','earn-review','earn-snapshot','evidence-ingest','earn-settlement','earn-publication'])seed.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(HOSTED_PRINCIPAL.id,scope);
  for(const [n,tokenId] of ['hosted-a','hosted-b'].entries()){
   const at=activation+n*35*60000;
   seed.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run(tokenId,at,'1000000');
   importMarket(seed,{id:tokenId,symbol:n?'SYNB':'SYNA',ogSymbol:'SYNOG',attMint:key(10+n*3),ogMint:key(11+n*3),poolAddress:key(12+n*3),activatedAt:new Date(at).toISOString()});
   for(const [index,account] of accounts.entries()){
    recordSamplePrice(seed,{wallet:account.wallet,tokenId,asOfMs:nowMs-1000,stakedUnits:'10000000',validUntilMs:nowMs+300000,sourceRef:'synthetic-entry:'+account.label});
    recordSamplePrice(seed,{wallet:account.wallet,tokenId,asOfMs:cutoff,stakedUnits:index===0&&n===0?'0':'10000000',sourceRef:'synthetic-exact-cutoff:'+account.label});
   }
  }
  configureWorkload(seed,{effectiveEpoch:epoch,atMs:nowMs-2000,staffedMinutes:30,secondsPerReview:60,admissionLimit:20,operator:HOSTED_PRINCIPAL.id,reason:'Synthetic staffed B20 transcript'});
  configureAction(seed,{actionId:'synthetic-prior-action',label:'Synthetic prior component history',verifier:'synthetic-attestor',effectiveEpoch:epoch-1,enabled:true,atMs:start-2*HOSTED_DAY,actor:HOSTED_PRINCIPAL.id,evidenceRef:'synthetic-prior-action-policy'});
  recordActionCompletion(seed,{wallet:accounts[1].wallet,actionId:'synthetic-prior-action',verifier:'synthetic-attestor',verifiedMs:start-HOSTED_DAY+2000,sourceRef:'synthetic-prior-attestation'});
  for(const account of accounts)seed.prepare('INSERT INTO earn_owner_snapshots VALUES(?,?,?,?)').run(epoch,account.wallet,'[]','synthetic-complete-empty-ownership');
  const tables=['app_operator_scopes','earn_fixture_campaigns','market_fixtures','earn_workload_policies','price_sources','earn_stake_reads','price_observations','earn_action_catalog','earn_action_changes','earn_action_completions','earn_owner_snapshots','ops_config_audit'];
  for(const table of tables){const statements=seed.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>{const columns=Object.keys(row);return runtime.db.prepare('INSERT INTO '+table+' ('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...Object.values(row));});if(statements.length)await runtime.db.batch(statements);}
 }finally{seed.close();}
 await runtime.call({method:'set-clock',nowMs});
 const fixture={label:'synthetic-complete-hosted-transcript',accounts,browserAccount:accounts[3],epoch,start,cutoff,activation,nowMs,browserTokenId:'hosted-a',
  browserContentUrl:'https://example.test/synthetic-hosted-browser-contribution',principal:HOSTED_PRINCIPAL,
  advance:async ms=>{nowMs+=ms;return runtime.call({method:'set-clock',nowMs});},
  verify:()=>verifyHostedTranscript(runtime,fixture)};
 return fixture;
}
export async function authenticateHosted(runtime,account){
 let cookie='';
 const client=createClient({baseUrl:runtime.origin+'/api/v1',fetchImpl:async(url,init)=>{
  const headers=new Headers(init.headers);headers.set('origin',runtime.origin);if(cookie)headers.set('cookie',cookie);
  const response=await fetch(url,{...init,headers});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return response;
 }});
 const challenge=await client.createWalletChallenge({body:{wallet:account.wallet}});
 await client.verifyWalletSignature({body:{nonce:challenge.data.nonce,signature:encode58(sign(null,Buffer.from(challenge.data.message),account.privateKey))}});
 return {client,get cookie(){return cookie;},account};
}
