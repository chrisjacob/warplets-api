import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createApp} from '../../server/application.mjs';
import {seedBallot,recordDecision} from '../../governance/ballots.mjs';
import {encode58} from '../../server/base58.mjs';
import {createClient} from '../../contracts/client.mjs';
const DAY=86400000,origin='http://localhost';
const key=()=>{const keys=generateKeyPairSync('ed25519');return {...keys,wallet:encode58(keys.publicKey.export({type:'spki',format:'der'}).subarray(-32))};};
function seed(db,keys,now){
 for(const [id,opensAt,holders] of [['active',now-1000,keys.slice(0,2).map(k=>k.wallet)],['closed',now-4*DAY,[keys[0].wallet]],['zero',now-4*DAY,[]]]){
  seedBallot(db,{id,opensAt,currentTrancheOpenedAt:opensAt,holders,nextWhitelist:[]});
 }
 db.prepare('INSERT INTO genesis_votes VALUES(?,?,?,?)').run('closed',keys[0].wallet,'30',now-4*DAY+1);
 recordDecision(db,{id:'zero',choice:'7',noticeAt:now-4*DAY,decidedAt:now-2*DAY,rationale:'Synthetic founder choice with zero turnout.'},now);
}
async function copy(db,d1){for(const table of ['genesis_ballots','genesis_voters','genesis_votes','genesis_decisions']){
 for(const row of db.prepare(`SELECT * FROM ${table}`).all()){const columns=Object.keys(row);await d1.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...Object.values(row)).run();}
}}
test('retired Genesis ballots are absent from Node and Worker routes, SDK, capabilities and public terms',async t=>{
 const {mf,db:d1}=await localRuntime(t,new URL('./fixtures/governance-worker.ts',import.meta.url));
 const db=openDatabase();t.after(()=>db.close());const keys=[key(),key(),key()],now=Date.now();seed(db,keys,now);await copy(db,d1);
 const app=createApp(db),nodeBefore=JSON.stringify(db.prepare('SELECT * FROM genesis_votes').all());
 for(const fetch of [(url,init)=>app(new Request(url,init)),(url,init)=>mf.dispatchFetch(url,init)]){
  const spec=await (await fetch(origin+'/api/v1/openapi.json')).json();
  assert.ok(!Object.keys(spec.paths).some(path=>path.includes('/genesis/ballots')));
  assert.equal(spec.components.schemas.GenesisBallot,undefined);
  const caps=await (await fetch(origin+'/api/v1/capabilities')).json();
  assert.ok(!caps.features.some(feature=>feature.id==='genesis-advisory-vote'));
  assert.ok(!caps.features.flatMap(feature=>feature.routes).some(route=>route.path.includes('/genesis/ballots')));
  const client=createClient({baseUrl:origin+'/api/v1',fetchImpl:fetch});
  for(const operation of ['listGenesisBallots','getGenesisBallot','castGenesisVote'])assert.equal(client[operation],undefined);
  const terms=await (await fetch(origin+'/api/v1/policy')).json();
  assert.equal(terms.genesis.noticeHours,48);assert.equal(terms.genesis.cap,10000);
  for(const field of ['ballotHours','choices','votesPerWallet'])assert.equal(terms.genesis[field],undefined);
  const collections=await (await fetch(origin+'/api/v1/collections')).json();
  assert.equal(collections.items[0].ballotHours,undefined);
  const notice=await (await fetch(origin+'/api/v1/notifications/capabilities')).json();assert.deepEqual(notice.topics,['launch','rewards']);
  for(const path of ['/genesis/ballots','/genesis/ballots/active','/genesis/ballots/active/votes'])for(const method of ['GET','POST']){
   const response=await fetch(origin+'/api/v1'+path,{method,headers:{origin,'content-type':'application/json'},...(method==='POST'?{body:'{"choice":"7"}'}:{})});
   assert.equal(response.status,404,method+' '+path);assert.equal((await response.json()).error.code,'not_found');
  }
 }
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM genesis_votes').all()),nodeBefore);
 assert.equal((await d1.prepare('SELECT COUNT(*) n FROM genesis_votes').first()).n,1);
 assert.equal((await d1.prepare('SELECT COUNT(*) n FROM genesis_decisions').first()).n,1,'Historical founder decision remains retained');
});
test('actual D1 guarded governance rolls back omitted effects, reconciles lost acknowledgement and checks the clock at SQL admission',async t=>{
 const {mf,db:d1}=await localRuntime(t,new URL('./fixtures/governance-worker.ts',import.meta.url));const db=openDatabase();t.after(()=>db.close());
 const keys=[key(),key(),key()],now=Date.now();seed(db,keys,now);await copy(db,d1);await d1.prepare('CREATE TABLE governance_test_clock(now_ms INTEGER)').run();await d1.prepare('INSERT INTO governance_test_clock VALUES(?)').bind(now).run();
 const call=async(wallet,fault)=>{const r=await mf.dispatchFetch(origin+'/__fixture/vote',{method:'POST',body:JSON.stringify({wallet,ballotId:'active',choice:'7',nowMs:now,fault})});return {status:r.status,body:await r.json()};};
 assert.equal((await call(keys[0].wallet,'omit')).status,500);
 assert.equal((await d1.prepare("SELECT COUNT(*) n FROM genesis_votes WHERE ballot_id='active'").first()).n,0);assert.equal((await d1.prepare('SELECT COUNT(*) n FROM app_command_receipts').first()).n,0);
 assert.deepEqual(await call(keys[0].wallet,'lost-ack'),{status:200,body:{choice:'7',replayed:true}});
 assert.deepEqual(await call(keys[0].wallet),{status:200,body:{choice:'7',replayed:true}});
 const denied=await call(keys[1].wallet,'close');assert.equal(denied.status,409);assert.equal(denied.body.error.code,'ballot_closed');
 assert.equal((await d1.prepare("SELECT COUNT(*) n FROM genesis_votes WHERE ballot_id='active'").first()).n,1);
 await assert.rejects(d1.prepare("UPDATE genesis_votes SET choice='14' WHERE ballot_id='active'").run(),/immutable/);
 await assert.rejects(d1.prepare("DELETE FROM genesis_voters WHERE ballot_id='active'").run(),/immutable/);
});
