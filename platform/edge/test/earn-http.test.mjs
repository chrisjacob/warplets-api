import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {localRuntime} from './local-runtime.mjs';
import {openDatabase} from '../../storage/database.mjs';
import {createApp} from '../../server/application.mjs';
import {createNodeGuardedEarnService} from '../../application/node-context.mjs';
import {createClient,PlatformApiError} from '../../contracts/client.mjs';
import {encode58} from '../../server/base58.mjs';
import {recordSamplePrice} from '../../pricing/fixtures.mjs';
import {configureWorkload} from '../../earn/operations.mjs';
import {configureAction} from '../../earn/components.mjs';
import {grantIssuer} from '../../earn/verifiers.mjs';
import {PROOF_DOMAIN,signedCompletionBytes} from '../../earn/action-proof.mjs';
const now=20001*86400000+5000,origin='http://localhost',spec=JSON.parse(readFileSync(new URL('../../contracts/openapi.json',import.meta.url)));
function check(schema,value,path='$'){
 if(schema.$ref)return check(spec.components.schemas[schema.$ref.split('/').at(-1)],value,path);
 if(schema.anyOf){assert.ok(schema.anyOf.some(s=>{try{check(s,value,path);return true;}catch{return false;}}),path+' union');return;}
 if(schema.allOf){for(const s of schema.allOf)check(s,value,path);return;}
 if(Object.hasOwn(schema,'const'))assert.deepEqual(value,schema.const,path);if(schema.enum)assert.ok(schema.enum.includes(value),path);
 if(schema.type==='null')assert.equal(value,null,path);
 if(schema.type==='string'){assert.equal(typeof value,'string',path);if(schema.pattern)assert.match(value,new RegExp(schema.pattern),path);}
 if(schema.type==='integer')assert.ok(Number.isSafeInteger(value),path);if(schema.type==='boolean')assert.equal(typeof value,'boolean',path);
 if(schema.type==='array'){assert.ok(Array.isArray(value),path);value.forEach(v=>check(schema.items,v,path+'[]'));}
 if(schema.type==='object'){assert.ok(value&&typeof value==='object'&&!Array.isArray(value),path);for(const k of schema.required??[])assert.ok(Object.hasOwn(value,k),path+'.'+k);
  for(const [k,s] of Object.entries(schema.properties??{}))if(Object.hasOwn(value,k))check(s,value[k],path+'.'+k);}
}
function schemaFor(id,media='application/vnd.10x.v1+json'){
 const operation=Object.values(spec.paths).flatMap(p=>Object.values(p)).find(o=>o?.operationId===id);
 return Object.entries(operation.responses).find(([status])=>status.startsWith('2'))[1].content[media].schema;
}
const key=()=>{const keys=generateKeyPairSync('ed25519');return {...keys,wallet:encode58(keys.publicKey.export({type:'spki',format:'der'}).subarray(-32))};};
async function exercise({fetch,execute,review,count},keys,{issuer,grantRevision}){
 const actors=[];
 for(const keysForWallet of keys){
  const actor={cookie:'',wallet:keysForWallet.wallet,lastStatus:null};
  actor.raw=async(path,{headers={},...init}={})=>fetch(origin+path,{...init,headers:{origin,...(actor.cookie?{cookie:actor.cookie}:{}),...headers}});
  actor.client=createClient({baseUrl:origin+'/api/v1',fetchImpl:async(url,init)=>{const headers=new Headers(init.headers);headers.set('origin',origin);if(actor.cookie)headers.set('cookie',actor.cookie);
   const response=await fetch(url,{...init,headers});actor.lastStatus=response.status;const cookie=response.headers.get('set-cookie');if(cookie)actor.cookie=cookie.split(';')[0];return response;}});
  const challenge=await actor.client.createWalletChallenge({body:{wallet:actor.wallet}});check(schemaFor('createWalletChallenge'),challenge);
  const authenticated=await actor.client.verifyWalletSignature({body:{nonce:challenge.data.nonce,signature:encode58(sign(null,Buffer.from(challenge.data.message),keysForWallet.privateKey))}});check(schemaFor('verifyWalletSignature'),authenticated);
  actors.push(actor);
 }
 const [a,b,expired]=actors;
 assert.equal((await fetch(origin+'/api/v1/earn/me')).status,401);
 const capacity=await a.client.getEarnAdmissionCapacity();check(schemaFor('getEarnAdmissionCapacity'),capacity);assert.equal(capacity.data.limit,1);assert.equal(capacity.data.accepting,true);
 const ordinary=await a.raw('/api/v1/earn/capacity');const rawCapacity=await ordinary.json();check(schemaFor('getEarnAdmissionCapacity','application/json'),rawCapacity);assert.deepEqual(rawCapacity,capacity.data);
 const body=wallet=>({tokenId:'A',url:'https://example.test/'+wallet});
 const competing=await Promise.allSettled([a,b].map(actor=>actor.client.submitEarnContent({idempotencyKey:'shared-key',body:body(actor.wallet)})));
 assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);const winnerIndex=competing.findIndex(r=>r.status==='fulfilled'),winner=actors[winnerIndex],loser=actors[1-winnerIndex];
 const admitted=competing[winnerIndex].value;check(schemaFor('submitEarnContent'),admitted);assert.equal(winner.lastStatus,201);
 const losing=competing[1-winnerIndex].reason;assert.ok(losing instanceof PlatformApiError);assert.equal(losing.status,409);assert.ok(['board_capacity','revision_conflict'].includes(losing.code));
 assert.equal(await count('earn_submissions'),1);
 const replay=await winner.client.submitEarnContent({idempotencyKey:'shared-key',body:body(winner.wallet)});assert.equal(winner.lastStatus,200);assert.equal(replay.data.id,admitted.data.id);
 await assert.rejects(winner.client.submitEarnContent({idempotencyKey:'shared-key',body:{tokenId:'A',url:'https://example.test/different'}}),e=>e.code==='idempotency_conflict'&&e.status===409);
 const own=await winner.client.getMyEarnSubmissions();check(schemaFor('getMyEarnSubmissions'),own);assert.equal(own.items.length,1);assert.equal(own.items[0].id,admitted.data.id);assert.equal(own.items[0].score,null);
 assert.equal((await loser.client.getMyEarnSubmissions()).items.length,0);assert.equal((await winner.raw('/api/v1/earn/me/'+loser.wallet)).status,404);
 const filtered=await loser.raw('/api/v1/earn/me?wallet='+encodeURIComponent(winner.wallet));assert.deepEqual((await filtered.json()).items,[]);
 const reviewInput={submissionId:admitted.data.id,score:8,reason:'synthetic private note',sourceRef:'synthetic moderation'};
 const reviewed=await review(reviewInput);assert.equal(reviewed.recorded,true);assert.equal(reviewed.replayed,false);
 assert.deepEqual(await review(reviewInput),{...reviewed,replayed:true});
 await assert.rejects(review({...reviewInput,score:9}),e=>e.status===409&&e.code==='idempotency_conflict');
 assert.equal(await count('earn_reviews'),1);
 const hidden=await winner.client.getMyEarnSubmissions();assert.equal(hidden.items[0].score,null);assert.equal(hidden.items[0].reason,null);
 assert.equal((await winner.raw('/api/v1/earn/reviews')).status,404);
 assert.ok([404,405].includes((await winner.raw('/api/v1/earn/reviews',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status));
 await execute('UPDATE earn_workload_policies SET admission_limit=10');
 await execute('INSERT INTO ops_scope_log VALUES(?,?,?,?,?,?,?,?,?)',['synthetic-pause','earn-admission',1,null,now-2,'fixture','synthetic','fixture','pause']);
 await assert.rejects(loser.client.submitEarnContent({idempotencyKey:'shared-key',body:body(loser.wallet)}),e=>e.code==='scope_paused'&&e.status===409);
 assert.equal((await winner.client.submitEarnContent({idempotencyKey:'shared-key',body:body(winner.wallet)})).data.id,admitted.data.id);
 await execute('INSERT INTO ops_scope_log VALUES(?,?,?,?,?,?,?,?,?)',['synthetic-resume','earn-admission',0,'synthetic-pause',now-1,'fixture','synthetic','fixture','resume']);
 const independent=await loser.client.submitEarnContent({idempotencyKey:'shared-key',body:body(loser.wallet)});assert.notEqual(independent.data.id,admitted.data.id);assert.equal(await count('earn_submissions'),2);
 await assert.rejects(review({...reviewInput,submissionId:independent.data.id,expectedRevisions:{source:'999999999'}}),e=>e.status===409&&e.code==='revision_conflict');
 assert.equal(await count('earn_reviews'),1);
 await assert.rejects(expired.client.submitEarnContent({idempotencyKey:'expired-stake',body:body(expired.wallet)}),e=>e.code==='stake_evidence_pending'&&e.status===503);
 const errors=[
  [{headers:{origin:'https://wrong.example','content-type':'application/json'},body:'{}'},403,'invalid_origin'],
  [{headers:{'content-type':'text/plain'},body:'{}'},415,'unsupported_media_type'],
  [{headers:{'content-type':'application/json'},body:'{'},400,'invalid_input'],
  [{headers:{'content-type':'application/json'},body:JSON.stringify({tokenId:'A',url:'https://example.test/x',wallet:winner.wallet})},400,'invalid_input'],
  [{headers:{'content-type':'application/json'},body:JSON.stringify({tokenId:'A',url:'x'.repeat(5000)})},413,'body_too_large'],
 ];
 for(const [options,status,code] of errors){const response=await expired.raw('/api/v1/earn/submissions',{method:'POST',...options});assert.equal(response.status,status);assert.equal((await response.json()).error.code,code);}
 const claims=await winner.client.getMyEarnClaims();check(schemaFor('getMyEarnClaims'),claims);assert.equal(claims.executionEnabled,false);
 const actions=await winner.client.listActiveEarnActions();check(schemaFor('listActiveEarnActions'),actions);
 const actionId='synthetic-action',proof={domain:PROOF_DOMAIN,issuerId:'synthetic-issuer',grantRevision,actionId,wallet:loser.wallet,
  nonce:'synthetic-proof-nonce-0001',issuedAtMs:now,expiresMs:now+120000,sourceHash:'f'.repeat(64)};
 const signed=proof=>({proof,signature:encode58(sign(null,signedCompletionBytes(proof),issuer.privateKey))});
 const signedBody=signed(proof),complete=(actor,body)=>actor.client.submitSignedActionCompletion({path:{actionId},body});
 const beforeAction=(await loser.client.getMyEarnSubmissions()).memberStatus.actions.items;
 assert.deepEqual(beforeAction.map(a=>a.status),['pending']);
 await assert.rejects(complete(winner,signedBody),e=>e.status===400&&e.code==='invalid_input');
 await assert.rejects(complete(loser,{...signedBody,followed:true}),e=>e.status===400&&e.code==='invalid_input');
 await assert.rejects(complete(loser,{...signedBody,proof:{...proof,followed:true}}),e=>e.status===400&&e.code==='invalid_input');
 assert.equal(await count('earn_signed_completions'),0);assert.equal(await count('earn_action_completions'),0);
 const completion=await complete(loser,signedBody);check(schemaFor('submitSignedActionCompletion'),completion);
 const proofDigest=createHash('sha256').update(JSON.stringify([PROOF_DOMAIN,Buffer.from(signedCompletionBytes(proof)).toString('base64'),signedBody.signature])).digest('hex');
 assert.deepEqual(completion.data,{actionId,verifiedAtMs:now,proofDigest,replay:false});
 const member=await loser.client.getMyEarnSubmissions();check(schemaFor('getMyEarnSubmissions'),member);
 assert.deepEqual(member.memberStatus.actions.items,[{actionId,label:'Synthetic attested action',verifier:'synthetic-verifier',startEpoch:20001,
  status:'verified',verifiedAt:new Date(now).toISOString(),sourceRef:'signed:'+proofDigest}]);
 assert.equal((await winner.client.getMyEarnSubmissions()).memberStatus.actions.items[0].status,'pending');
 await assert.rejects(complete(winner,signed({...proof,wallet:winner.wallet})),e=>e.status===409&&e.code==='nonce_conflict');
 await execute('INSERT INTO earn_issuer_revocations VALUES(?,?,?)',['synthetic-issuer',now,'b'.repeat(64)]);
 await execute('UPDATE earn_action_changes SET enabled=0 WHERE action_id=?',[actionId]);
 const completionReplay=await complete(loser,signedBody);check(schemaFor('submitSignedActionCompletion'),completionReplay);
 assert.deepEqual(completionReplay.data,{...completion.data,replay:true});
 await assert.rejects(complete(expired,signed({...proof,wallet:expired.wallet,nonce:'synthetic-proof-nonce-0002'})),e=>e.status===400&&e.code==='invalid_input');
 assert.equal(await count('earn_signed_completions'),1);assert.equal(await count('earn_action_completions'),1);
 const board=await winner.client.getEarnLeaderboard({path:{epoch:new Date(now).toISOString().slice(0,10)}});check(schemaFor('getEarnLeaderboard'),board);assert.equal(board.status,'pending');
 const cookieToken=winner.cookie.slice(winner.cookie.indexOf('=')+1);await execute('UPDATE sessions SET expires_at=? WHERE token_hash=?',[now,createHash('sha256').update(cookieToken).digest('hex')]);
 await assert.rejects(winner.client.getMyEarnSubmissions(),e=>e.status===401&&e.code==='authentication_required'&&!!e.requestId);
 return {submissions:await count('earn_submissions'),reviews:await count('earn_reviews'),signedCompletions:await count('earn_signed_completions'),board:board.status,financialExecution:claims.executionEnabled};
}
test('generated client uses the same guarded Earn HTTP flow in Node and actual workerd',async t=>{
 const keys=[key(),key(),key()],issuer=key(),seed=openDatabase();t.after(()=>seed.close());
 configureAction(seed,{actionId:'synthetic-action',label:'Synthetic attested action',verifier:'synthetic-verifier',effectiveEpoch:20001,enabled:true,atMs:20001*86400000-1});
 const {revision:grantRevision}=grantIssuer(seed,{issuerId:'synthetic-issuer',actionId:'synthetic-action',verifier:'synthetic-verifier',pubkey:issuer.wallet,
  fromEpoch:20001,untilEpoch:20004,atMs:20001*86400000-1,actor:'fixture',evidenceRef:'synthetic issuer grant'});
 seed.prepare('INSERT INTO earn_fixture_campaigns VALUES(?,?,?)').run('A',now-1000,'1000000');
 configureWorkload(seed,{effectiveEpoch:Math.floor(now/86400000),atMs:now-1000,staffedMinutes:10,secondsPerReview:60,admissionLimit:1,operator:'fixture',reason:'synthetic staffing'});
 seed.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run('synthetic-reviewer','earn-review');
 keys.forEach((k,i)=>recordSamplePrice(seed,{wallet:k.wallet,tokenId:'A',asOfMs:now-200,stakedUnits:'10000000',validUntilMs:i===2?now-100:now+1000}));
 const tables=['earn_fixture_campaigns','earn_workload_policies','app_operator_scopes','price_sources','earn_stake_reads','price_observations','earn_action_catalog','earn_action_changes','earn_issuer_grants','ops_config_audit'];
 const {mf,db}=await localRuntime(t,new URL('./fixtures/earn-http-worker.ts',import.meta.url));
 for(const table of tables){const statements=seed.prepare('SELECT * FROM '+table+' ORDER BY rowid').all().map(row=>{const columns=Object.keys(row);return db.prepare('INSERT INTO '+table+' ('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').bind(...Object.values(row));});if(statements.length)await db.batch(statements);}
 const app=createApp(seed,{clock:()=>now});
 const node=await exercise({fetch:(url,init)=>app(new Request(url,init)),execute:async(sql,values=[])=>seed.prepare(sql).run(...values),
  count:async table=>seed.prepare('SELECT COUNT(*) n FROM '+table).get().n,
  review:input=>createNodeGuardedEarnService(seed,{nowMs:now}).recordFinalReview({kind:'operator',id:'synthetic-reviewer'},input)},keys,{issuer,grantRevision});
 const worker=await exercise({fetch:(url,init)=>mf.dispatchFetch(url,init),execute:async(sql,values=[])=>db.prepare(sql).bind(...values).run(),
  count:table=>db.prepare('SELECT COUNT(*) n FROM '+table).first('n'),review:async input=>{const response=await mf.dispatchFetch(origin+'/__fixture/review',{method:'POST',body:JSON.stringify(input)});const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error.message),{status:response.status,code:value.error.code});return value;}},keys,{issuer,grantRevision});
 assert.deepEqual(worker,node);
});
