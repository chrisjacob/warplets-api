import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorApp} from './console.mjs';
import {openDatabase} from '../storage/database.mjs';
import {encode58} from '../server/base58.mjs';
import {addCampaign,recordStakeRead,submitContent} from '../earn/workflow.mjs';
import {createApp} from '../server/application.mjs';

test('separate operator session, same-origin writes and immutable final review',async t=>{
 const db=openDatabase();t.after(()=>db.close());
 const clock=Date.parse('2026-11-04T04:00:10.000Z'),date='2026-11-04',origin='http://127.0.0.1:4174';
 const token='operator-test-code-with-more-than-32-characters';
 const handler=createOperatorApp(db,{bootToken:token,clock:()=>clock});
 const req=(path,value,auth,extra={})=>new Request(origin+'/ops/'+path,{method:value?'POST':'GET',
   headers:{origin,'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{}),...extra},body:value?JSON.stringify(value):undefined});
 const login=await handler(req('login',{code:token}));assert.equal(login.status,200);
 const {sessionToken}=await login.json();assert.ok(sessionToken);
 assert.equal((await handler(req('login',{code:token}))).status,401);
 assert.equal((await handler(req('board?date='+date))).status,401);
 assert.equal((await handler(req('capacity',{date},sessionToken,{origin:'http://another.example'}))).status,403);
 assert.equal((await handler(req('capacity',{date,staffedMinutes:30,secondsPerReview:180,admissionLimit:50,reason:'Staffed pilot'},sessionToken))).status,200);
 const wallet=encode58(Buffer.alloc(32,1));addCampaign(db,{tokenId:'dst',activationMs:clock-86400000,originalUnits:'200000'});
 recordStakeRead(db,{wallet,tokenId:'dst',observedMs:clock-1000,expiresMs:clock+1000,microUsd:'10000000',sourceRef:'operator_fixture'});
 const {submission}=submitContent(db,{wallet,tokenId:'dst',url:'https://example.org/original',requestKey:'new-post',nowMs:clock});
 const board=await (await handler(req('board?date='+date,undefined,sessionToken))).json();
 assert.equal(board.metrics.capacity.limit,10);assert.equal(board.queue.items.length,1);
 const review={submissionId:submission.id,score:8,reason:'Clear, specific content',final:true};
 assert.equal((await handler(req('reviews',review,sessionToken))).status,200);
 assert.equal((await (await handler(req('reviews',review,sessionToken))).json()).replayed,true);
 assert.equal((await handler(req('reviews',{...review,score:9},sessionToken))).status,409);
 assert.equal((await createApp(db)(req('board?date='+date,undefined,sessionToken))).status,404);
 assert.equal((await handler(req('logout',{},sessionToken))).status,200);
 assert.equal((await handler(req('status',undefined,sessionToken))).status,401);
});
