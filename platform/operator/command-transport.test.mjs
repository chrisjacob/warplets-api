import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {createOperatorSessionAuthority} from './session.mjs';
import {createOperatorCommandTransport} from './command-transport.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {verifyConfigChain} from '../operations/audit.mjs';
const origin='http://127.0.0.1:4174',now=Date.parse('2026-11-07T01:00:00Z');
const kind='ops.configure-workload.v1';
function fixture(t,{expireOnWrite=false,crypto}={}){
 const db=openDatabase();t.after(()=>db.close());db.exec("INSERT INTO app_operator_scopes VALUES('fixture-operator','operations',0,1)");
 const sessions=createOperatorSessionAuthority({bootCode:'fixture-bootstrap-code-longer-than-32-characters',operatorId:'fixture-operator',allowedKinds:[kind],
 clock:()=>now+(expireOnWrite&&db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n?7200000:0)});
 const token=sessions.login('fixture-bootstrap-code-longer-than-32-characters').sessionToken;
 const handler=createOperatorCommandTransport(db,{sessions,clock:()=>now,...(crypto?{crypto}:{} )});
 const expectedRevisions=Object.fromEntries(db.prepare('SELECT name,revision FROM app_revisions').all().map(r=>[r.name,String(r.revision)]));
 const body={operationKind:kind,requestKey:'fixture-staffing',expectedRevisions,input:{effectiveEpoch:Math.floor(now/86400000),staffedMinutes:30,secondsPerReview:180,admissionLimit:50,reason:'Fixture staffing'}};
 const request=(path,value=body,headers={})=>new Request(origin+'/ops/commands/'+path,{method:'POST',headers:{origin,'content-type':'application/json',authorization:'Bearer '+token,...headers},body:typeof value==='string'?value:JSON.stringify(value)});
 return {db,sessions,handler,body,request};
}
test('preview binds exact input; accepted execution replays with one audit child',async t=>{
 const {db,handler,body,request}=fixture(t);
 const preview=await handler(request('preview'));assert.equal(preview.status,200);const p=await preview.json();
 assert.equal(p.financialExecution,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,0);
 assert.equal((await handler(request('execute'))).status,409);
 const headers={'x-operator-preview':p.confirmationDigest};
 const first=await handler(request('execute',body,headers));assert.equal(first.status,200);assert.equal((await first.json()).kind,'committed');
 const retry=await handler(request('execute',body,headers));assert.equal((await retry.json()).kind,'replayed');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,1);verifyConfigChain(db);
 assert.equal((await handler(request('execute',{...body,input:{...body.input,admissionLimit:51}},headers))).status,409);
});
test('transport enforces origin, authentication, bounded input and exact revisions',async t=>{
 const {handler,request,body}=fixture(t);
 assert.equal((await handler(request('preview',body,{origin:'https://elsewhere.example'}))).status,403);
 assert.equal((await handler(request('preview',body,{authorization:'Bearer member'}))).status,401);
 assert.equal((await handler(request('preview',' '.repeat(16385)))).status,413);
 assert.equal((await handler(request('preview',{...body,principal:{kind:'operator',id:'other'}}))).status,400);
 assert.equal((await handler(request('preview',{...body,expectedRevisions:{...body.expectedRevisions,control:'999999'}}))).status,409);
});
test('session revoked across asynchronous hashing cannot preview or execute',async t=>{
 let sessions;const nodeCrypto=createNodeCrypto();
 const f=fixture(t,{crypto:{...nodeCrypto,async sha256(bytes){sessions.revoke();return nodeCrypto.sha256(bytes);}}});sessions=f.sessions;
 assert.equal((await f.handler(f.request('preview'))).status,401);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);
});
test('expiry immediately before commit rolls back business, receipt and audit together',async t=>{
 const {db,handler,request,body}=fixture(t,{expireOnWrite:true});
 const p=await (await handler(request('preview'))).json();
 const response=await handler(request('execute',body,{'x-operator-preview':p.confirmationDigest}));assert.equal(response.status,401);
 for(const table of ['app_command_receipts','ops_config_audit','earn_workload_policies'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);
});

test('fresh authentication replays an accepted receipt after database scope revocation',async t=>{
 const {db,sessions,handler,request,body}=fixture(t);
 const preview=await (await handler(request('preview'))).json(),headers={'x-operator-preview':preview.confirmationDigest};
 assert.equal((await handler(request('execute',body,headers))).status,200);
 sessions.revoke();const next=sessions.login(sessions.issueBootCode());
 db.exec("UPDATE app_operator_scopes SET enabled=0,revision=revision+1");
 const retry=await handler(request('execute',body,{...headers,authorization:'Bearer '+next.sessionToken}));
 assert.equal(retry.status,200);assert.equal((await retry.json()).kind,'replayed');
 const fresh={...body,requestKey:'fresh-denied'};
 const {prepareOperatorCommand}=await import('../application/operator-commands.mjs');
 const prepared=await prepareOperatorCommand({principal:next.principal,request:fresh,nowMs:now},createNodeCrypto());
 const denied=await handler(request('execute',fresh,{'x-operator-preview':prepared.preview.confirmationDigest,authorization:'Bearer '+next.sessionToken}));
 assert.equal(denied.status,409);assert.equal((await denied.json()).code,'operator_scope_required');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,1);
});

test('audited final review uses its narrow scope and binds confirmation revisions without changing historical receipt digest',async t=>{
 const {createNodeAtomicDriver}=await import('../storage/node/atomic-driver.mjs');
 const {createAtomicEarnRepository}=await import('../storage/atomic-earn.mjs');
 const {seed,command,start}=await import('../storage/fixtures/atomic-earn.mjs');
 const {randomUUID}=await import('node:crypto');
 const {prepareOperatorCommand}=await import('../application/operator-commands.mjs');
 const db=openDatabase();t.after(()=>db.close());const driver=createNodeAtomicDriver(db),crypto=createNodeCrypto();await seed(driver);
 const admitted=await createAtomicEarnRepository(driver,{crypto,ids:{next:randomUUID}}).admitSubmission(await command());
 const sessions=createOperatorSessionAuthority({bootCode:'fixture-final-review-code-longer-than-32',operatorId:'synthetic-operator',allowedKinds:['earn.final-review.v1'],clock:()=>start});
 const login=sessions.login('fixture-final-review-code-longer-than-32'),handler=createOperatorCommandTransport(db,{sessions,clock:()=>start});
 const body={operationKind:'earn.final-review.v1',requestKey:admitted.value.submission.id,
  expectedRevisions:Object.fromEntries(db.prepare('SELECT name,revision FROM app_revisions').all().map(r=>[r.name,String(r.revision)])),
  input:{submissionId:admitted.value.submission.id,score:8,reason:'Synthetic final assessment',sourceRef:'fixture/final-review'}};
 const request=(path,value=body,confirmation)=>new Request(origin+'/ops/commands/'+path,{method:'POST',headers:{origin,'content-type':'application/json',authorization:'Bearer '+login.sessionToken,...(confirmation?{'x-operator-preview':confirmation}:{})},body:JSON.stringify(value)});
 const previewResponse=await handler(request('preview'));assert.equal(previewResponse.status,200);const preview=await previewResponse.json();
 assert.equal(preview.summary.final,true);assert.equal(db.prepare('SELECT COUNT(*) n FROM earn_reviews').get().n,0);
 const revised={...body,expectedRevisions:{...body.expectedRevisions,control:String(Number(body.expectedRevisions.control)+1)}};
 const revisedPrepared=await prepareOperatorCommand({principal:login.principal,request:revised,nowMs:start},crypto);
 assert.equal(revisedPrepared.command.requestDigest,preview.requestDigest);assert.notEqual(revisedPrepared.preview.confirmationDigest,preview.confirmationDigest);
 assert.equal((await handler(request('execute',revised,preview.confirmationDigest))).status,409);
 const accepted=await handler(request('execute',body,preview.confirmationDigest));assert.equal(accepted.status,200);assert.equal((await accepted.json()).kind,'committed');
 assert.equal(db.prepare('SELECT category FROM ops_config_audit').get().category,'final-review');
 db.exec("UPDATE app_operator_scopes SET enabled=0,revision=revision+1");
 const retry=await handler(request('execute',body,preview.confirmationDigest));assert.equal((await retry.json()).kind,'replayed');
 const changed={...body,input:{...body.input,score:9}},different=await prepareOperatorCommand({principal:login.principal,request:changed,nowMs:start},crypto);
 const conflict=await handler(request('execute',changed,different.preview.confirmationDigest));assert.equal(conflict.status,409);assert.equal((await conflict.json()).code,'idempotency_conflict');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,1);assert.equal(db.prepare('SELECT content_score FROM earn_reviews').get().content_score,8);
});

test('receipt lookup resolves legacy saved commands without executing absent or changed commands',async t=>{
 const {db,handler,body,request}=fixture(t);
 const missing=await handler(request('receipt'));assert.equal(missing.status,404);assert.equal((await missing.json()).error.code,'receipt_not_found');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,0);
 const preview=await (await handler(request('preview'))).json();
 const accepted=await (await handler(request('execute',body,{'x-operator-preview':preview.confirmationDigest}))).json();
 db.exec('UPDATE app_operator_scopes SET enabled=0,revision=revision+1');
 const resolved=await handler(request('receipt'));assert.equal(resolved.status,200);const outcome=await resolved.json();assert.equal(outcome.kind,'replayed');assert.deepEqual(outcome.receipt,accepted.receipt);
 const conflict=await handler(request('receipt',{...body,input:{...body.input,reason:'Different saved body'}}));assert.equal(conflict.status,409);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,1);
});
