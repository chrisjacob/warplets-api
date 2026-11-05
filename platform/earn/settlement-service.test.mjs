import test from 'node:test';
import assert from 'node:assert/strict';
import {cutoffScenario} from '../application/fixtures/cutoff-scenario.mjs';
import {createEarnSettlementService,SETTLEMENT_PREPARATION_LIMITS} from './settlement-service.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {settlementFenceKey} from '../storage/atomic-settlement.mjs';
import {createSettlementPreparationRepository} from '../storage/settlement-preparation.mjs';
import {computeAllocation,computeBoard} from './settlement.mjs';
import {allocationWindow,DAY_MS} from '../domain/earn/index.mjs';
import {U64_MAX} from '../domain/economics/index.mjs';
const copy=value=>JSON.parse(canonicalJson(value)),crypto=createNodeCrypto();
async function fixture(t,options){
 const env=await cutoffScenario(options);t.after(()=>env.db.close());
 assert.equal((await env.service.assemble(env.principal,env.query)).kind,'committed');
 const repository=createSettlementPreparationRepository(env.driver,env.ports);
 const make=(changes={})=>createEarnSettlementService({repository,artifacts:env.store,crypto:env.crypto,clock:env.clock,...changes});
 return {...env,preparation:repository,make,settlement:make()};
}
function lease(env,command){
 const result={businessKey:settlementFenceKey(command.operationKind,command.input),token:'synthetic-'+command.operationKind,revision:'1',payloadDigest:command.requestDigest};
 env.db.prepare('INSERT INTO app_execution_fences(business_key,holder_token,revision,payload_digest,expires_ms) VALUES(?,?,?,?,?)').run(result.businessKey,result.token,1,result.payloadDigest,env.clock.nowMs()+10000);
 return result;
}
const boardQuery=env=>({epoch:env.epoch,requestKey:'synthetic-prepare-board'});

test('complete persisted B05 manifest prepares byte-identical board and allocation commands for the fenced repository',async t=>{
 const env=await fixture(t,{position:true}),prepared=await env.settlement.prepareBoard(env.principal,boardQuery(env));
 assert.equal(prepared.kind,'prepared',JSON.stringify(prepared));assert.equal(Object.isFrozen(prepared.command.input),true);
 const loaded=await env.preparation.loadBoardPreparation({epoch:env.epoch}),root=JSON.parse(new TextDecoder().decode(env.objects.get(loaded.sealed.objectKey)));
 const input=JSON.parse(new TextDecoder().decode(env.objects.get(root.inputObject.key)));
 assert.deepEqual(prepared.plan,computeBoard(input));assert.equal(prepared.command.input.planDigest,await crypto.sha256(utf8(canonicalJson(prepared.plan))));
 const repeated=await env.settlement.prepareBoard(env.principal,boardQuery(env));assert.deepEqual(repeated,prepared);
 const committed=await env.settlementRepository.commitBoard(prepared.command,lease(env,prepared.command));assert.equal(committed.kind,'committed');
 assert.equal(await crypto.sha256(utf8(JSON.stringify(prepared.plan.commitmentInput))),committed.value.snapshotId,'prepared commitment bytes preserve the historical SQL projection order');
 const final=await env.make({artifacts:{async getVerified(){throw Error('Final replay must not read artifacts');}}}).prepareBoard(env.principal,boardQuery(env));
 assert.equal(final.kind,'final');assert.equal(final.snapshotId,committed.value.snapshotId);
 const allocation=await env.settlement.prepareAllocation(env.principal,{tokenId:'A',day:2,requestKey:'synthetic-allocation'});
 assert.equal(allocation.kind,'prepared');assert.equal(allocation.plan.budgetUnits,'10000');assert.equal(allocation.plan.burnUnits,'9000');
 const recorded=await env.settlementRepository.commitAllocation(allocation.command,lease(env,allocation.command));assert.equal(recorded.kind,'committed');
 assert.equal((await env.settlement.prepareAllocation(env.principal,{tokenId:'A',day:2,requestKey:'synthetic-allocation'})).kind,'recorded');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM manifest_catalog').get().n,0);
});

test('positive empty bootstrap produces a valid empty plan while sourceComplete cannot bypass the service',async t=>{
 const env=await fixture(t,{post:false}),result=await env.settlement.prepareBoard(env.principal,boardQuery(env));
 assert.equal(result.kind,'prepared');assert.deepEqual(result.plan.winners,[]);
 await assert.rejects(env.settlement.prepareBoard(env.principal,{...boardQuery(env),sourceComplete:true}),/Unexpected settlement preparation fields/);
 const empty=await env.make({repository:{...env.preparation,async loadBoardPreparation(){return {kind:'pending',reason:'complete-input-required',dependencyIds:['board:20']};}}}).prepareBoard(env.principal,boardQuery(env));
 assert.equal(empty.reason,'complete-input-required');
});

test('each missing private manifest page or input object holds the named exact object instead of settling',async t=>{
 const env=await fixture(t),loaded=await env.preparation.loadBoardPreparation({epoch:env.epoch});
 const manifest=JSON.parse(new TextDecoder().decode(env.objects.get(loaded.sealed.objectKey)));
 for(const key of [loaded.sealed.objectKey,...Object.values(manifest.artifacts).flat().map(i=>i.key),manifest.inputObject.key]){
  const bytes=env.objects.get(key);env.objects.delete(key);
  const result=await env.settlement.prepareBoard(env.principal,boardQuery(env));
  assert.equal(result.reason,'settlement-object-missing');assert.deepEqual(result.dependencyIds,[key]);env.objects.set(key,bytes);
 }
 const key=manifest.inputObject.key,bytes=env.objects.get(key);env.objects.set(key,utf8('{}'));
 assert.equal((await env.settlement.prepareBoard(env.principal,boardQuery(env))).reason,'settlement-object-conflict');env.objects.set(key,bytes);
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM earn_boards').get().n,0);
});

test('current missing and incomplete evidence heads cannot reuse the earlier complete vectors',async t=>{
 const env=await fixture(t);
 const heads=await env.preparation.selectHeads([]);assert.equal(heads.size,0);
 for(const mode of ['missing','pending']){
  let selected;
  const repository={...env.preparation,async selectHeads(specs){const heads=await env.preparation.selectHeads(specs);selected=specs.find(s=>s.authority==='evidence');
   const head=heads.get(selected.id);heads.set(selected.id,mode==='missing'?null:{...head,decision:{...head.decision,status:'pending'}});return heads;}};
  const result=await env.make({repository}).prepareBoard(env.principal,boardQuery(env));
  assert.equal(result.reason,'snapshot-dependencies');assert.ok(result.dependencyIds.includes(selected.id));
 }
});

test('a real SQL correction invalidates the sealed dependency vector and cannot prepare a changed immutable board',async t=>{
 const env=await fixture(t);env.db.prepare("UPDATE earn_reviews SET content_score=9").run();
 const result=await env.settlement.prepareBoard(env.principal,boardQuery(env));assert.equal(result.reason,'input-revision-changed');
 assert.equal(env.db.prepare('SELECT COUNT(*) n FROM earn_boards').get().n,0);
});

test('one preparation read race recomputes once; persistent races hold without spinning',async t=>{
 const env=await fixture(t);
 for(const persistent of [false,true]){
  let reads=0,loads=0;
  const repository={...env.preparation,async loadBoardPreparation(q){loads++;return env.preparation.loadBoardPreparation(q);},async readVersions(){
   const versions=await env.preparation.readVersions();return persistent||reads++===0?{...versions,source:String(BigInt(versions.source)+1n)}:versions;}};
  const result=await env.make({repository}).prepareBoard(env.principal,boardQuery(env));
  assert.equal(loads,2);assert.equal(result.kind,persistent?'pending':'prepared');
  if(persistent)assert.equal(result.reason,'settlement-revision-conflict');
 }
});

test('caller mutation during asynchronous hashing cannot alter prepared authority, epoch or idempotency identity',async t=>{
 const env=await fixture(t),principal={...env.principal},query=boardQuery(env);let mutated=false;
 const racingCrypto={...env.crypto,async sha256(bytes){if(!mutated){mutated=true;principal.id='attacker';query.epoch++;query.requestKey='changed';}return env.crypto.sha256(bytes);}};
 const result=await env.make({crypto:racingCrypto}).prepareBoard(principal,query);
 assert.equal(result.kind,'prepared');assert.deepEqual(result.command.principal,env.principal);assert.equal(result.command.input.epoch,env.epoch);assert.equal(result.command.requestKey,'synthetic-prepare-board');
 assert.throws(()=>{result.command.principal.id='rewritten';},TypeError);
});

test('manifest and preparation limits fail closed before an oversized artifact is read',async t=>{
 const env=await fixture(t),loaded=await env.preparation.loadBoardPreparation({epoch:env.epoch});let reads=0;
 const repository={...env.preparation,async loadBoardPreparation(){return {...loaded,manifestIdentity:{...loaded.manifestIdentity,size:SETTLEMENT_PREPARATION_LIMITS.objectBytes+1}};}};
 const result=await env.make({repository,artifacts:{async getVerified(){reads++;throw Error('oversized read');}}}).prepareBoard(env.principal,boardQuery(env));
 assert.equal(result.reason,'settlement-object-identity');assert.equal(reads,0);
});

test('allocation preparation preserves activation-relative day-ten dates, cap/dust and maximum validu64 supply for zero through100 winners',async()=>{
 const versions={earn:'0',source:'0',control:'0'},principal={kind:'operator',id:'synthetic-settlement'};
 for(const activationMs of [20*DAY_MS,20*DAY_MS+35*60000])for(const count of [0,5,10,100]){
  const day=10,window=allocationWindow(activationMs,day),nowMs=activationMs+40*DAY_MS,originalSupplyUnits=String(U64_MAX-U64_MAX%200n);
  const board={epoch:window.boardEpoch,status:'final',snapshotId:'a'.repeat(64),winners:Array.from({length:count},(_,i)=>({wallet:'wallet-'+i,pointsTenths:i===0?1000:1}))};
  const repository={async loadAllocationPreparation(){return {kind:'loaded',versions,campaign:{activationMs,originalSupplyUnits},board};},async readVersions(){return versions;}};
  const service=createEarnSettlementService({repository,artifacts:null,crypto,clock:{nowMs:()=>nowMs}}),result=await service.prepareAllocation(principal,{tokenId:'A',day,requestKey:'day-ten'});
  assert.equal(result.kind,'prepared');assert.deepEqual(result.plan,computeAllocation({tokenId:'A',day,activationMs,originalSupplyUnits,nowMs,board}));
  assert.equal(result.plan.vestsFromMs,activationMs+10*DAY_MS);assert.equal(result.plan.vestsThroughMs,activationMs+11*DAY_MS);
  assert.equal(result.plan.awards.reduce((sum,a)=>sum+BigInt(a.amountUnits),BigInt(result.plan.burnUnits)),BigInt(result.plan.budgetUnits));
  for(const award of result.plan.awards)assert.ok(BigInt(award.amountUnits)*10n<=BigInt(result.plan.budgetUnits));
 }
});

test('guarded preparation holds invalid supply policy before computing an allocation',async()=>{
 const principal={kind:'operator',id:'synthetic'},versions={earn:'0',source:'0',control:'0'},activationMs=20*DAY_MS;
 for(const originalSupplyUnits of ['0','100',String(U64_MAX+1n),'184467440737095516200','1e6','-200','0200',' 200','0xc8','NaN']){
  const repository={async loadAllocationPreparation(){return {kind:'loaded',versions,campaign:{activationMs,originalSupplyUnits},board:null};},async readVersions(){return versions;}};
  const result=await createEarnSettlementService({repository,artifacts:null,crypto,clock:{nowMs:()=>activationMs}}).prepareAllocation(principal,{tokenId:'A',day:1,requestKey:'invalid-supply'});
  assert.deepEqual(result,{kind:'pending',reason:'campaign-supply-policy',dependencyIds:['A']},originalSupplyUnits);
 }
});

test('allocation uses only the designated board and preserves scheduled or missing dependencies',async()=>{
 const activationMs=20*DAY_MS,versions={earn:'0',source:'0',control:'0'},principal={kind:'operator',id:'synthetic'},campaign={activationMs,originalSupplyUnits:'1000000'};
 for(const [nowMs,board,reason] of [[activationMs-1,null,'allocation-scheduled'],[activationMs,null,'board-required'],[activationMs,{epoch:20,status:'final',snapshotId:'a'.repeat(64),winners:[]},'allocation-board-mismatch']]){
  const repository={async loadAllocationPreparation(){return {kind:'loaded',versions,campaign,board};},async readVersions(){return versions;}};
  const result=await createEarnSettlementService({repository,artifacts:null,crypto,clock:{nowMs:()=>nowMs}}).prepareAllocation(principal,{tokenId:'A',day:1,requestKey:'allocation'});
  assert.equal(result.reason,reason);if(reason==='allocation-scheduled')assert.equal(result.readyMs,activationMs);
 }
});
