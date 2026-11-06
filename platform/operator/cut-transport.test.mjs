import test from 'node:test';
import assert from 'node:assert/strict';
import {freeCutFixture,CUT_OPERATOR} from '../collect/free-cut-test-fixture.mjs';
import {createOperatorSessionAuthority} from './session.mjs';
import {createOperatorCommandTransport} from './command-transport.mjs';
const origin='http://127.0.0.1:4174';

test('free-cut operator previews bind the published opening, and execute only exact begin/page/seal commands',async t=>{
 const f=await freeCutFixture(t);await f.stage();f.setNow(Date.now());
 const kinds=['collection.begin-free-cut.v1','collection.validate-cut-page.v1','collection.seal-free-cut.v1'];
 const sessions=createOperatorSessionAuthority({bootCode:'synthetic-cut-bootstrap-longer-than32',operatorId:CUT_OPERATOR.id,allowedKinds:kinds});
 const token=sessions.login('synthetic-cut-bootstrap-longer-than32').sessionToken,handler=createOperatorCommandTransport(f.db,{sessions});
 const revisions=()=>Object.fromEntries(f.db.prepare('SELECT name,revision FROM app_revisions').all().map(r=>[r.name,String(r.revision)]));
 const request=(path,body,confirmation)=>new Request(origin+'/ops/commands/'+path,{method:'POST',headers:{origin,'content-type':'application/json',authorization:'Bearer '+token,...(confirmation?{'x-operator-preview':confirmation}:{})},body:JSON.stringify(body)});
 const make=(kind,input,key)=>({operationKind:kind,input,requestKey:key,expectedRevisions:revisions()});
 const run=async body=>{const before=f.db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,response=await handler(request('preview',body));assert.equal(response.status,200);const preview=await response.json();
  assert.equal(preview.summary.context.cutMs,f.cutMs);assert.equal(preview.summary.financialExecution,false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,before);
  assert.ok(!JSON.stringify(preview).includes(f.holders[0]));const accepted=await handler(request('execute',body,preview.confirmationDigest));assert.equal(accepted.status,200);const result=await accepted.json();assert.equal(result.kind,'committed');return {result,preview,body};};
 const begun=await run(make(kinds[0],{rootId:f.bundle.root.id},'synthetic-console-cut-begin'));
 const attemptId=begun.result.value.attemptId;
 const early=await handler(request('preview',make(kinds[2],{attemptId},'synthetic-early-seal')));assert.equal(early.status,202);assert.equal((await early.json()).reason,'cut-page-closure');
 await run(make(kinds[1],{attemptId,pageIndex:0},'synthetic-console-cut-page'));
 const sealed=await run(make(kinds[2],{attemptId},'synthetic-console-cut-seal'));
 assert.equal(sealed.result.value.atMs,f.cutMs);assert.equal(sealed.result.value.eligibleWallets,2);
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(CUT_OPERATOR.id);
 const replay=await handler(request('execute',sealed.body,sealed.preview.confirmationDigest));assert.equal((await replay.json()).kind,'replayed');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
});
