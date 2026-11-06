import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
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
async function exercise(fetch,keys,expire){
 const actors=[];
 for(const keysForWallet of keys){const actor={cookie:'',lastStatus:null};
  actor.raw=(path,init={})=>fetch(origin+'/api/v1'+path,{...init,headers:{origin,cookie:actor.cookie,...init.headers}});
  actor.client=createClient({baseUrl:origin+'/api/v1',fetchImpl:async(url,init)=>{const headers=new Headers(init.headers);headers.set('origin',origin);if(actor.cookie)headers.set('cookie',actor.cookie);const r=await fetch(url,{...init,headers});actor.lastStatus=r.status;if(r.headers.has('set-cookie'))actor.cookie=r.headers.get('set-cookie').split(';')[0];return r;}});
  const challenge=await actor.client.createWalletChallenge({body:{wallet:keysForWallet.wallet}});
  await actor.client.verifyWalletSignature({body:{nonce:challenge.data.nonce,signature:encode58(sign(null,Buffer.from(challenge.data.message),keysForWallet.privateKey))}});actors.push(actor);
 }
 const [a,b,outside]=actors,post=(actor,body,headers={})=>actor.raw('/genesis/ballots/active/votes',{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});
 assert.equal((await fetch(origin+'/api/v1/genesis/ballots/active/votes',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{"choice":"7"}'})).status,401);
 const vote=actor=>actor.client.castGenesisVote({path:{id:'active'},body:{choice:'7'}});
 const parallel=await Promise.all([vote(a),vote(a)]);assert.deepEqual(parallel.map(r=>r.data.replayed).sort(),[false,true]);
 assert.deepEqual((await vote(b)).data,{choice:'7',replayed:false});
 await assert.rejects(a.client.castGenesisVote({path:{id:'active'},body:{choice:'14'}}),e=>e.status===409&&e.code==='idempotency_conflict');
 await assert.rejects(vote(outside),e=>e.status===403&&e.code==='voter_ineligible');
 const ordinary=await (await a.raw('/genesis/ballots/active')).json(),detail=await a.client.getGenesisBallot({path:{id:'active'}});
 assert.deepEqual(ordinary,detail.data);assert.equal(ordinary.votesCast,2);assert.equal(ordinary.counts,null);
 for(const keysForWallet of keys)assert.ok(!JSON.stringify(ordinary).includes(keysForWallet.wallet));
 const closed=await a.client.castGenesisVote({path:{id:'closed'},body:{choice:'30'}});assert.deepEqual(closed.data,{choice:'30',replayed:true});assert.equal(a.lastStatus,200);
 const zero=(await a.client.getGenesisBallot({path:{id:'zero'}})).data;assert.deepEqual(zero.counts,{ASAP:0,7:0,14:0,30:0});assert.equal(zero.votesCast,0);assert.equal(zero.decision.choice,'7');
 const listed=await a.client.listGenesisBallots();assert.equal(listed.items.length,3);
 for(const [body,headers,status,code] of [
  [{choice:'7'},{origin:'http://wrong.test'},403,'invalid_origin'],
  [{choice:'7',wallet:keys[0].wallet},{},400,'invalid_input'],
  ['{',{},400,'invalid_input'],
  [{choice:'5'},{},422,'invalid_choice'],
  [{choice:'7'},{'content-type':'text/plain'},415,'unsupported_media_type'],
  [{choice:'x'.repeat(5000)},{},413,'body_too_large'],
 ]){const response=await post(outside,body,headers);assert.equal(response.status,status);assert.equal((await response.json()).error.code,code);}
 assert.equal((await a.raw('/genesis/ballots/active?wallet='+keys[0].wallet)).status,400);
 assert.equal((await a.raw('/genesis/ballots/active/votes')).status,405);
 assert.equal((await a.raw('/genesis/ballots/no-such')).status,404);
 let limited;for(let i=0;i<13;i++){limited=await post(b,{choice:'7'});if(limited.status===429)break;}assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>0);
 await expire();assert.equal((await post(a,{choice:'7'})).status,401);
 return {ordinary,zero};
}
test('shared guarded governance HTTP: Node/workerd generated-client, genuine wallet proof, privacy, replay, body and quota parity',async t=>{
 const {mf,db:d1}=await localRuntime(t,new URL('./fixtures/governance-worker.ts',import.meta.url));
 const db=openDatabase();t.after(()=>db.close());const keys=[key(),key(),key()],now=Date.now();seed(db,keys,now);await copy(db,d1);
 const app=createApp(db);const node=await exercise((url,init)=>app(new Request(url,init)),keys,async()=>{db.prepare('UPDATE sessions SET expires_at=0').run();});
 const edge=await exercise((url,init)=>mf.dispatchFetch(url,init),keys,async()=>{await d1.prepare('UPDATE sessions SET expires_at=0').run();});
 assert.deepEqual(edge,node);
 const nodeVotes=db.prepare('SELECT * FROM genesis_votes ORDER BY ballot_id,wallet').all(),edgeVotes=(await d1.prepare('SELECT * FROM genesis_votes ORDER BY ballot_id,wallet').all()).results;
 assert.deepEqual(edgeVotes.map(({voted_ms,...row})=>row),nodeVotes.map(({voted_ms,...row})=>({...row})));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM app_command_receipts WHERE operation_kind='governance.cast-vote.v1'").get().n,3);
 assert.equal((await d1.prepare("SELECT COUNT(*) n FROM app_command_receipts WHERE operation_kind='governance.cast-vote.v1'").first()).n,3);
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
