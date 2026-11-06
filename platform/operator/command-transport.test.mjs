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
 const headers={'x-operator-preview':p.requestDigest};
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
 const response=await handler(request('execute',body,{'x-operator-preview':p.requestDigest}));assert.equal(response.status,401);
 for(const table of ['app_command_receipts','ops_config_audit','earn_workload_policies'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);
});

test('fresh authentication replays an accepted receipt after database scope revocation',async t=>{
 const {db,sessions,handler,request,body}=fixture(t);
 const preview=await (await handler(request('preview'))).json(),headers={'x-operator-preview':preview.requestDigest};
 assert.equal((await handler(request('execute',body,headers))).status,200);
 sessions.revoke();const next=sessions.login(sessions.issueBootCode());
 db.exec("UPDATE app_operator_scopes SET enabled=0,revision=revision+1");
 const retry=await handler(request('execute',body,{...headers,authorization:'Bearer '+next.sessionToken}));
 assert.equal(retry.status,200);assert.equal((await retry.json()).kind,'replayed');
 const fresh={...body,requestKey:'fresh-denied'};
 const {prepareOperatorCommand}=await import('../application/operator-commands.mjs');
 const prepared=await prepareOperatorCommand({principal:next.principal,request:fresh,nowMs:now},createNodeCrypto());
 const denied=await handler(request('execute',fresh,{'x-operator-preview':prepared.command.requestDigest,authorization:'Bearer '+next.sessionToken}));
 assert.equal(denied.status,409);assert.equal((await denied.json()).code,'operator_scope_required');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM app_command_receipts').get().n,1);
});
