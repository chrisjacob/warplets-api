import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openDatabase} from '../storage/database.mjs';
import {encode58} from '../server/base58.mjs';
import {handleBallots,seedBallot,recordDecision} from './ballots.mjs';
const day=86400000;
test('frozen electorate, duplicate/replay, privacy and founder rationale survive retries',async t=>{
 const db=openDatabase();t.after(()=>db.close());
 const wallet=encode58(Buffer.alloc(32,1)),other=encode58(Buffer.alloc(32,2));
 const at=Date.now(),origin='http://127.0.0.1:4173';
 const input={id:'tranche-2',opensAt:at,currentTrancheOpenedAt:at,holders:[wallet],nextWhitelist:[wallet]};
 const digest=seedBallot(db,input);assert.equal(seedBallot(db,input),digest);
 assert.throws(()=>seedBallot(db,{...input,nextWhitelist:[other]}),/frozen/);
 for(const [key,id] of [['alice',wallet],['bob',other]])db.prepare('INSERT INTO sessions VALUES(?,?,?,?)')
  .run(createHash('sha256').update(key).digest('hex'),id,origin,at+4*day);
 const vote=(key,choice,now=at,from=origin)=>handleBallots(db,new Request(origin+'/api/v1/genesis/ballots/tranche-2/votes',{
  method:'POST',headers:{origin:from,cookie:'tenx_local_session='+key,'content-type':'application/json'},body:JSON.stringify({choice})}),'local',now);
 const detail=now=>handleBallots(db,new Request(origin+'/api/v1/genesis/ballots/tranche-2'),'local',now);
 assert.equal((await vote('alice','ASAP',at,'http://other')).status,403);
 assert.equal((await vote('bob','7')).status,403);assert.equal((await vote('alice','ASAP')).status,201);
 assert.equal((await vote('alice','ASAP')).status,200);assert.equal((await vote('alice','14')).status,409);
 const open=await (await detail(at)).json();assert.equal(open.counts,null);assert.equal(open.eligibleWallets,1);
 const closed=await (await detail(at+2*day)).json();assert.equal(closed.counts.ASAP,1);
 assert.ok(!JSON.stringify(closed).includes(wallet));
 const decision={id:input.id,choice:'14',noticeAt:at,decidedAt:at+2*day,rationale:'Allow more time between tranches.'};
 const saved=recordDecision(db,decision,at+2*day);assert.equal(saved.earliestOpening,new Date(at+14*day).toISOString());
 assert.deepEqual(recordDecision(db,decision,at+2*day),saved);
 assert.throws(()=>recordDecision(db,{...decision,choice:'7'},at+2*day),/already recorded/);
});
