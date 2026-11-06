import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperatorApp} from './console.mjs';
import {openDatabase} from '../storage/database.mjs';
import {encode58} from '../server/base58.mjs';
import {addCampaign,recordStakeRead,submitContent} from '../earn/workflow.mjs';
import {createApp} from '../server/application.mjs';

test('separate operator session, same-origin audited writes and unavailable legacy review',async t=>{
 const db=openDatabase();t.after(()=>db.close());
 const clock=Date.parse('2026-11-04T04:00:10.000Z'),date='2026-11-04',origin='http://127.0.0.1:4174';
 const token='operator-test-code-with-more-than-32-characters';
 db.exec("INSERT INTO app_operator_scopes VALUES('local-founder','operations',0,1)");
 const handler=createOperatorApp(db,{bootToken:token,clock:()=>clock,allowedKinds:['ops.configure-workload.v1']});
 const req=(path,value,auth,extra={})=>new Request(origin+'/ops/'+path,{method:value?'POST':'GET',
   headers:{origin,'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{}),...extra},body:value?JSON.stringify(value):undefined});
 const login=await handler(req('login',{code:token}));assert.equal(login.status,200);
 const {sessionToken}=await login.json();assert.ok(sessionToken);
 assert.equal((await handler(req('login',{code:token}))).status,401);
 assert.equal((await handler(req('board?date='+date))).status,401);
 assert.equal((await handler(req('capacity',{date},sessionToken,{origin:'http://another.example'}))).status,403);
 const status=await (await handler(req('status',undefined,sessionToken))).json();
 const command={operationKind:'ops.configure-workload.v1',requestKey:'fixture-capacity',expectedRevisions:status.expectedRevisions,
 input:{effectiveEpoch:Math.floor(clock/86400000),staffedMinutes:30,secondsPerReview:180,admissionLimit:50,reason:'Staffed pilot'}};
 const preview=await (await handler(req('commands/preview',command,sessionToken))).json();
 assert.equal((await handler(req('commands/execute',command,sessionToken,{'x-operator-preview':preview.requestDigest}))).status,200);
 assert.equal((await handler(req('capacity',{date},sessionToken))).status,503);
 const wallet=encode58(Buffer.alloc(32,1));addCampaign(db,{tokenId:'dst',activationMs:clock-86400000,originalUnits:'200000'});
 recordStakeRead(db,{wallet,tokenId:'dst',observedMs:clock-1000,expiresMs:clock+1000,microUsd:'10000000',sourceRef:'operator_fixture'});
 const {submission}=submitContent(db,{wallet,tokenId:'dst',url:'https://example.org/original',requestKey:'new-post',nowMs:clock});
 const board=await (await handler(req('board?date='+date,undefined,sessionToken))).json();
 assert.equal(board.metrics.capacity.limit,10);assert.equal(board.queue.items.length,1);
 const review={submissionId:submission.id,score:8,reason:'Clear, specific content',final:true};
 assert.equal((await handler(req('reviews',review,sessionToken))).status,503);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_reviews').get().n,0);
 assert.equal((await createApp(db)(req('board?date='+date,undefined,sessionToken))).status,404);
 assert.equal((await handler(req('logout',{},sessionToken))).status,200);
 assert.equal((await handler(req('status',undefined,sessionToken))).status,401);
});

test('default console grants no command permission and rate limits bootstrap attempts',async t=>{
 const db=openDatabase();t.after(()=>db.close());const origin='http://127.0.0.1:4174',bootToken='fixture-no-default-authority-32-characters';
 let now=100000;const handler=createOperatorApp(db,{bootToken,clock:()=>now});
 const req=(path,body,token)=>new Request(origin+'/ops/'+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 for(let i=0;i<5;i++)assert.equal((await handler(req('login',{code:'invalid'}))).status,401);
 const throttled=await handler(req('login',{code:bootToken}));assert.equal(throttled.status,429);assert.equal(throttled.headers.get('retry-after'),'60');
 now+=60000;const session=await (await handler(req('login',{code:bootToken}))).json();
 const status=await (await handler(req('status',undefined,session.sessionToken))).json();assert.deepEqual(status.allowedKinds,[]);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_operator_scopes').get().n,0);
 assert.equal((await handler(req('commands/preview',{operationKind:'ops.configure-workload.v1'},session.sessionToken))).status,403);
 const config=await (await handler(req('config',undefined,session.sessionToken))).json();
 assert.equal(config.financialExecution,false);assert.ok(config.scopes.length>0);
 for(const protectedScope of ['vault-claim','earn-claim','operation-recovery'])assert.equal(config.scopes.some(row=>row.scope===protectedScope),false);
});
