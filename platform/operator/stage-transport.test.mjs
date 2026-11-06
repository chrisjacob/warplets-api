import test from 'node:test';
import assert from 'node:assert/strict';
import {governanceOperatorFixture} from '../governance/operator-test-fixture.mjs';
import {createCollection} from '../collect/store.mjs';
import {verifyConfigChain} from '../operations/audit.mjs';
import {createOperatorSessionAuthority} from './session.mjs';
import {createOperatorCommandTransport} from './command-transport.mjs';
const kind='collection.publish-stage.v1',actor='synthetic-stage-console',origin='http://127.0.0.1:4174';
async function fixture(t){
 const f=await governanceOperatorFixture(t),now=Date.now();f.setNow(now);
 f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(actor,'collection-publication');
 const code='synthetic-stage-bootstrap-longer-than32',sessions=createOperatorSessionAuthority({bootCode:code,operatorId:actor,allowedKinds:[kind]});
 const token=sessions.login(code).sessionToken,handler=createOperatorCommandTransport(f.db,{sessions});
 const versions=()=>Object.fromEntries(f.db.prepare('SELECT name,revision FROM app_revisions').all().map(r=>[r.name,String(r.revision)]));
 const body=(input,key=input.stageId)=>({operationKind:kind,requestKey:key,input,expectedRevisions:versions()});
 const send=async(path,b,confirmation)=>{const r=await handler(new Request(origin+'/ops/commands/'+path,{method:'POST',headers:{origin,'content-type':'application/json',authorization:'Bearer '+token,...(confirmation?{'x-operator-preview':confirmation}:{})},body:JSON.stringify(b)}));return {status:r.status,value:await r.json()};};
 const input=(inventoryId,changes={})=>({inventoryId,stageId:'synthetic-stage',type:'whitelist',publishedAt:now,opensAt:now+172800000,closesAt:now+259200000,priceLamports:'100000000',costLamports:'500000',allocation:100,walletLimit:1,founderApproved:false,approvedSpendLamports:null,ballotId:null,inventoryOverrideReason:null,eligibilityListId:f.groups[0].manifest.id,sourceKind:'synthetic-local-operator-fixture',...changes});
 const publish=async b=>{const before=f.db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,p=await send('preview',b);assert.equal(p.status,200,JSON.stringify(p));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM ops_config_audit').get().n,before);assert.equal(p.value.financialExecution,false);assert.ok(!JSON.stringify(p).includes(f.holders[0]));const r=await send('execute',b,p.value.confirmationDigest);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.value.kind,'committed');assert.equal(r.value.value.executable,false);return {preview:p.value,result:r.value};};
 return {...f,now,body,send,input,publish};
}
test('explicit founder/public fixture publication requires both scopes and binds approval budget in confirmation',async t=>{
 const f=await fixture(t);createCollection(f.db,{id:'synthetic-founder',kind:'genesis',tranche:1});
 let b=f.body(f.input('synthetic-founder',{type:'founder',priceLamports:'0',founderApproved:true,approvedSpendLamports:'50000000'}));
 const denied=await f.send('preview',b);assert.equal(denied.status,409);assert.equal(denied.value.code,'operator_scope_required');
 f.db.prepare('INSERT INTO app_operator_scopes VALUES(?,?,0,1)').run(actor,'collection-founder');b={...b,expectedRevisions:f.body(b.input).expectedRevisions};
 const p=await f.send('preview',b);assert.equal(p.status,200);assert.equal(p.value.summary.approvedSpendLamports,'50000000');
 const altered=structuredClone(b);altered.input.approvedSpendLamports='50000001';assert.equal((await f.send('execute',altered,p.value.confirmationDigest)).value.error.code,'preview_required');
 f.db.prepare("UPDATE app_operator_scopes SET enabled=0 WHERE operator=? AND scope='collection-founder'").run(actor);
 assert.equal((await f.send('execute',b,p.value.confirmationDigest)).value.code,'operator_scope_required');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_stages').get().n,0);
 f.db.prepare("UPDATE app_operator_scopes SET enabled=1 WHERE operator=? AND scope='collection-founder'").run(actor);b=f.body(b.input);
 const accepted=await f.publish(b);
 const publicBody=f.body(f.input('synthetic-founder',{stageId:'synthetic-public',type:'public',founderApproved:true,eligibilityListId:null}));const pub=await f.publish(publicBody);assert.deepEqual(pub.result.value.eligibility,{kind:'unrestricted',listId:null,count:null});
 f.db.prepare('UPDATE app_operator_scopes SET enabled=0 WHERE operator=?').run(actor);const replay=await f.send('execute',b,accepted.preview.confirmationDigest);assert.equal(replay.value.kind,'replayed');assert.deepEqual(replay.value.receipt,accepted.result.receipt);
 verifyConfigChain(f.db);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);
});
test('free preview remains pending membership and enforces both preceding paid schedules',async t=>{
 const f=await fixture(t),id='synthetic-free-console';createCollection(f.db,{id,kind:'season',seasonStart:f.now});
 const free=f.input(id,{stageId:'free',type:'free',priceLamports:'0',eligibilityListId:null,opensAt:f.now+4000,closesAt:f.now+5000});
 const held=await f.send('preview',f.body(free));assert.equal(held.status,202);assert.equal(held.value.reason,'paid_stages_incomplete');
 for(let n=0;n<2;n++)await f.publish(f.body(f.input(id,{stageId:'paid-'+n,opensAt:f.now+1000+n*1000,closesAt:f.now+2000+n*1000})));
 const accepted=await f.publish(f.body(free));assert.deepEqual(accepted.result.value.eligibility,{kind:'pending',listId:null,count:null});assert.equal(accepted.preview.summary.opensAt,free.opensAt);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_free_cuts').get().n,0);verifyConfigChain(f.db);
});
