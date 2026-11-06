import test from 'node:test';
import assert from 'node:assert/strict';
import {governanceOperatorFixture,GOVERNANCE_OPERATOR,GOVERNANCE_OPEN} from '../governance/operator-test-fixture.mjs';
import {createOperatorSessionAuthority} from './session.mjs';
import {createOperatorCommandTransport} from './command-transport.mjs';
import {verifyConfigChain} from '../operations/audit.mjs';
const origin='http://127.0.0.1:4174',DAY=86400000;

test('scoped advisory governance preview and final decision share atomic audit receipts without opening a collection',async t=>{
 const f=await governanceOperatorFixture(t),sessions=createOperatorSessionAuthority({bootCode:'synthetic-governance-bootstrap-more-than32',operatorId:GOVERNANCE_OPERATOR.id,
  allowedKinds:['governance.publish-ballot.v1','governance.record-decision.v1'],clock:f.getNow});
 let token=sessions.login('synthetic-governance-bootstrap-more-than32').sessionToken;
 const handler=createOperatorCommandTransport(f.db,{sessions,clock:f.getNow});
 const revisions=()=>Object.fromEntries(f.db.prepare('SELECT name,revision FROM app_revisions').all().map(r=>[r.name,String(r.revision)]));
 const request=(path,body,confirmation)=>new Request(origin+'/ops/commands/'+path,{method:'POST',headers:{origin,'content-type':'application/json',authorization:'Bearer '+token,...(confirmation?{'x-operator-preview':confirmation}:{})},body:JSON.stringify(body)});
 const publication={operationKind:'governance.publish-ballot.v1',requestKey:'synthetic-console-ballot',input:f.input,expectedRevisions:revisions()};
 const previewResponse=await handler(request('preview',publication));assert.equal(previewResponse.status,200);const preview=await previewResponse.json();
 assert.equal(preview.summary.advisory,true);assert.equal(preview.summary.financialExecution,false);assert.equal(preview.summary.snapshotHash,f.expectedHash);assert.equal(preview.summary.eligibleCount,4);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM genesis_ballots').get().n,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,0);
 const published=await handler(request('execute',publication,preview.confirmationDigest));assert.equal(published.status,200);assert.equal((await published.json()).kind,'committed');
 f.setNow(GOVERNANCE_OPEN+2*DAY);assert.equal((await handler(request('receipt',publication))).status,401);
 token=sessions.login(sessions.issueBootCode()).sessionToken;
 assert.equal((await (await handler(request('execute',publication,preview.confirmationDigest))).json()).kind,'replayed');
 const decision={operationKind:'governance.record-decision.v1',requestKey:'synthetic-console-decision',expectedRevisions:revisions(),input:{ballotId:f.input.ballotId,choice:'7',decidedMs:f.getNow(),noticeMs:GOVERNANCE_OPEN,rationale:'Synthetic advisory rationale'}};
 const decisionResponse=await handler(request('preview',decision));assert.equal(decisionResponse.status,200);const dp=await decisionResponse.json();assert.equal(dp.summary.earliestMs,GOVERNANCE_OPEN+6*DAY);assert.equal(dp.summary.ballotSnapshotHash,f.expectedHash);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM genesis_decisions').get().n,0);
 const accepted=await handler(request('execute',decision,dp.confirmationDigest));assert.equal(accepted.status,200);assert.equal((await accepted.json()).kind,'committed');
 f.db.exec("UPDATE app_operator_scopes SET enabled=0,revision=revision+1 WHERE scope='governance-decision'");
 assert.equal((await (await handler(request('execute',decision,dp.confirmationDigest))).json()).kind,'replayed');
 assert.equal(verifyConfigChain(f.db).events,2);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM collect_inventories').get().n,0);
});
