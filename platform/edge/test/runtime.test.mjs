import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {build} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {encode58} from '../../server/base58.mjs';
import {makeCapabilities} from '../../contracts/capabilities.mjs';

test('real workerd verifies a D1 wallet proof once and protects R2 public artifacts',async t=>{
 const entry=fileURLToPath(new URL('../src/worker.ts',import.meta.url));
 const bundle=await build({entryPoints:[entry],bundle:true,platform:'browser',format:'esm',write:false,
   sourcemap:false,minify:false,target:'es2022'});
 const mf=new Miniflare({workers:[{config:{name:'tenx-test',type:'worker',compatibilityDate:'2026-08-25',
   manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}},
   env:{DB:{type:'d1',id:'00000000-0000-4000-8000-000000000001'},MANIFESTS:{type:'r2',name:'tenx-local-manifests'}}}}]});
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB'),bucket=await mf.getR2Bucket('MANIFESTS');
 const storage=new URL('../../storage/',import.meta.url);
 for(const name of readdirSync(storage).filter(n=>/^\d+.*\.sql$/.test(n)).sort()){
   const sql=readFileSync(new URL(name,storage),'utf8').replace(/^--.*$/gm,'');
   const statements=[];let statement='';
   for(const line of sql.split(/\r?\n/)){
     statement+=(statement?'\n':'')+line;
     const value=statement.trim();
     if(value.endsWith(';')&&(!value.startsWith('CREATE TRIGGER')||/\bEND;$/i.test(value))){
       statements.push(db.prepare(value));statement='';
     }
   }
   assert.equal(statement.trim(),'','Incomplete migration '+name);
   await db.batch(statements);
 }
 const origin='http://localhost',url=origin+'/api/v1';
 const get=(path,headers={})=>mf.dispatchFetch(url+path,{headers});
 const post=(path,body,headers={})=>mf.dispatchFetch(url+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 const policy=await (await get('/policy')).json();assert.equal(policy.version,'prd-1.2');
 const capabilityResponse=await get('/capabilities');assert.equal(capabilityResponse.status,200);
 assert.deepEqual(await capabilityResponse.json(),makeCapabilities('workerd-local'));
 const negotiatedCapabilities=await (await get('/capabilities',{accept:'application/vnd.10x.v1+json'})).json();
 assert.deepEqual(negotiatedCapabilities.data,makeCapabilities('workerd-local'));
 assert.equal((await (await get('/openapi.json')).json()).paths['/capabilities'].get.operationId,'getCapabilities');
 const workerSpec=await (await get('/openapi.json')).json();
 const advertised=new Set(makeCapabilities('workerd-local').features.flatMap(f=>f.routes.map(r=>r.method+' '+r.path.slice(7))));
 for(const [path,item] of Object.entries(workerSpec.paths))for(const method of ['get','post','put','patch','delete']){
   if(item[method])assert.ok(advertised.has(method.toUpperCase()+' '+path),'Missing Worker capability '+method+' '+path);
 }
 assert.equal((await get('/me')).status,401);assert.equal((await get('/markets')).status,200);
 const pair=generateKeyPairSync('ed25519'),wallet=encode58(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32));
 assert.equal((await post('/auth/challenges',{wallet},{origin:'http://outside.test'})).status,403);
 const challengeRes=await post('/auth/challenges',{wallet});assert.equal(challengeRes.status,201);
 const identity=Buffer.alloc(32);identity[0]=1;
 assert.equal((await post('/auth/challenges',{wallet:encode58(identity)})).status,400);
 const challenge=await challengeRes.json();
 const proof={nonce:challenge.nonce,signature:encode58(sign(null,Buffer.from(challenge.message),pair.privateKey))};
 const replies=await Promise.all([post('/auth/verify',proof),post('/auth/verify',proof)]);
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,401]);
 const cookie=replies.find(r=>r.status===200).headers.get('set-cookie').split(';')[0];
 assert.equal((await (await get('/me',{cookie})).json()).wallet,wallet);
 const time=Date.now();
 await db.batch([
  db.prepare('INSERT INTO genesis_ballots VALUES(?,?,?,?,?,?)').bind('next',time-1000,time+86400000,time-86400000,'digest',1),
  db.prepare('INSERT INTO genesis_voters VALUES(?,?)').bind('next',wallet)
 ]);
 const votes=await Promise.all([post('/genesis/ballots/next/votes',{choice:'ASAP'},{cookie}),post('/genesis/ballots/next/votes',{choice:'ASAP'},{cookie})]);
 assert.deepEqual(votes.map(r=>r.status).sort(),[200,201]);
 assert.equal((await post('/genesis/ballots/next/votes',{choice:'7'},{cookie})).status,409);
 const ballot=await (await get('/genesis/ballots/next')).json();assert.equal(ballot.votesCast,1);assert.equal(ballot.counts,null);
 for(const path of ['/vault','/stake/positions','/earn/claims']){
   assert.equal((await get(path)).status,401);
   const owned=await (await get(path,{cookie,accept:'application/vnd.10x.v1+json'})).json();
   assert.deepEqual(owned.items,[]);assert.ok(owned.meta.policyVersion);
 }
 const pending=await (await get('/earn/epochs/2026-11-01/leaderboard')).json();assert.equal(pending.status,'pending');
 assert.equal((await get('/earn/epochs/2026-02-31/leaderboard')).status,400);
 const activated=Math.floor(time/1000)*1000-3*86400000;
 const slot=JSON.stringify({kind:'genesis',tranche:1,level:1,ordinal:0});
 await db.batch([
  db.prepare('INSERT INTO market_fixtures(id,att_mint,pool_address,body) VALUES(?,?,?,?)').bind('local','att','pool','{}'),
  db.prepare('INSERT INTO vault_manifests VALUES(?,?,?,?,?,?,?)').bind('local',activated,'20130000','0','402600000','[]','fixture-digest'),
  db.prepare('INSERT INTO vault_assets VALUES(?,?,?,?,?)').bind('owned',slot,slot,wallet,time),
  db.prepare('INSERT INTO vault_claim_totals VALUES(?,?,?)').bind('owned','local','300'),
  db.prepare('INSERT INTO stake_fixture_farms VALUES(?,?,?,?,?)').bind('local',activated,'402600000','20130000',0),
  db.prepare('INSERT INTO stake_fixture_events(id,market_id,kind,wallet,at_ms,amount) VALUES(?,?,?,?,?,?)').bind('dep','local','deposit',wallet,activated,'100')
 ]);
 assert.equal((await (await get('/nfts/owned/vault')).json()).items[0].claimable,'700');
 assert.equal((await (await get('/vault',{cookie})).json()).items[0].id,'owned');
 assert.equal((await (await get('/farms/local')).json()).totalStakedUnits,'100');
 assert.equal((await (await get('/stake/positions',{cookie})).json()).items[0].principalUnits,'100');
 await post('/auth/logout',{}, {cookie});assert.equal((await get('/me',{cookie})).status,401);
 const document='{"policy":"prd-1.2","audience":"public"}',key=createHash('sha256').update(document).digest('hex'),objectKey='public/'+key+'.json';
 await bucket.put(objectKey,document,{httpMetadata:{contentType:'application/json'}});
 assert.equal((await get('/manifests/'+key)).status,404);
 await db.prepare('INSERT INTO manifest_catalog VALUES(?,?,?,?,?)').bind(key,objectKey,Buffer.byteLength(document),'public-test',Date.now()).run();
 const out=await get('/manifests/'+key);assert.equal(out.status,200);assert.equal(await out.text(),document);
 await bucket.put(objectKey,document.replace('public','SECRET'),{httpMetadata:{contentType:'application/json'}});
 const broken=await get('/manifests/'+key);assert.equal(broken.status,503);assert.ok(!(await broken.text()).includes('SECRET'));
 assert.equal((await mf.dispatchFetch('https://public.example/api/v1/policy')).status,403);
});
