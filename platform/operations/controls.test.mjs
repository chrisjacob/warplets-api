import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../storage/database.mjs';
import { changeScope, actionDecision, recordUsage, reserveOptionalCost, settleOptionalCost, costPressure, protectedScopes } from './controls.mjs';
import { createApp } from '../server/application.mjs';
import { addCampaign, submitContent } from '../earn/workflow.mjs';
import { recordSamplePrice } from '../pricing/fixtures.mjs';
import { DAY_MS } from '../domain/earn/index.mjs';

const at=Date.UTC(2026,10,5,12);
const setup=t=>{const db=openDatabase();t.after(()=>db.close());return db;};
function command(scope,overrides={}) {
  return {scope,paused:true,atMs:at,actor:'founder',reason:'fixture drill',evidenceRef:'incident-1',requestKey:'first',...overrides};
}
test('only named scopes pause, independent scopes continue, and resume requires the current revision',t=>{
  const db=setup(t), pause=command('launch-preparation');
  const result=changeScope(db,pause);assert.deepEqual(changeScope(db,pause),result);
  assert.equal(actionDecision(db,'launch-preparation',at).allowed,false);
  assert.equal(actionDecision(db,'collection-mint',at).allowed,true);
  assert.throws(()=>changeScope(db,command('vault-claim')),/protected/);
  assert.throws(()=>changeScope(db,{...pause,requestKey:'stale',paused:false,atMs:at+1}),/revision/);
  changeScope(db,{...pause,requestKey:'resume',paused:false,atMs:at+1,previousRevision:result.revision});
  assert.equal(actionDecision(db,'launch-preparation',at+1).allowed,true);
  assert.throws(()=>db.exec('UPDATE ops_scope_log SET paused=1'),/append only/);
});
test('warning and hard ceiling only gate optional/new work and persist recurring commitments across months',t=>{
  const db=setup(t), provider={provider:'provider',metric:'new-monthly-usd',atMs:at,evidenceRef:'invoice'};
  const warning=recordUsage(db,{...provider,measured:'4000000'});recordUsage(db,{...provider,measured:'4000000'});
  assert.equal(costPressure(db,at).level,'warning');
  assert.equal(actionDecision(db,'optional-images',at).allowed,false);
  assert.equal(actionDecision(db,'earn-admission',at).allowed,true);
  recordUsage(db,{...provider,measured:'5000000',atMs:at+1});
  assert.equal(costPressure(db,Date.UTC(2027,0,1)).level,'limit');
  for(const scope of protectedScopes)assert.equal(actionDecision(db,scope,at+1).allowed,true);
  assert.equal(actionDecision(db,'launch-preparation',at+1).allowed,false);
  recordUsage(db,{...provider,measured:'0',atMs:at+2,evidenceRef:'cancelled'});
  assert.equal(costPressure(db,at+2).level,'normal');
  recordUsage(db,{provider:'index',metric:'daily-provider-units',measured:'100',quota:'100',atMs:at,evidenceRef:'usage'});
  assert.equal(costPressure(db,at+2).level,'limit');
  assert.equal(costPressure(db,at+DAY_MS).level,'normal');
  assert.ok(warning.receipt);
});
test('a bounded reservation is replayable, concurrently budgeted and reconciles an actual overrun',t=>{
  const db=setup(t);
  const args={scope:'optional-notifications',now:at,upperUsdMicros:'3500000',actor:'adapter',quoteRef:'cap',requestKey:'one'};
  assert.equal(reserveOptionalCost(db,args).status,'reserved');
  assert.equal(reserveOptionalCost(db,args).replay,true);
  assert.equal(reserveOptionalCost(db,{...args,upperUsdMicros:'2500000',requestKey:'two'}).status,'held');
  assert.equal(settleOptionalCost(db,{requestKey:'one',actualUsdMicros:'5500000',evidenceRef:'actual'}).overrun,true);
  assert.equal(costPressure(db,at).recurring.status,'over-limit');
  assert.equal(settleOptionalCost(db,{requestKey:'one',actualUsdMicros:'5500000',evidenceRef:'actual'}).replay,true);
  assert.throws(()=>settleOptionalCost(db,{requestKey:'one',actualUsdMicros:'0',evidenceRef:'other'}),/another receipt/);
});
test('pause preserves wallet-specific replay and claim access in the actual Node app',async t=>{
  const db=setup(t);
  const tokenId='T',wallet='w';
  addCampaign(db,{tokenId,activationMs:at,originalUnits:'10000'});
  recordSamplePrice(db,{tokenId,wallet,asOfMs:at,stakedUnits:'10000000'});
  const original={wallet,tokenId,url:'https://example.org/post',requestKey:'one',nowMs:at};
  const first=submitContent(db,original);
  changeScope(db,command('earn-admission',{atMs:at+1}));
  assert.equal(submitContent(db,{...original,nowMs:at+2}).submission.id,first.submission.id);
  assert.throws(()=>submitContent(db,{...original,wallet:'other',nowMs:at+2}),e=>e.code==='scope_unavailable');
  changeScope(db,command('launch-preparation',{atMs:at+1,requestKey:'launch'}));
  const app=createApp(db,{clock:()=>at+2});
  const request=(path,method='GET')=>app(new Request('http://localhost/api/v1'+path,{method}));
  const launch=await request('/launch-plans/preview','POST');assert.equal(launch.status,503);
  assert.equal((await (await request('/earn/capacity')).json()).accepting,false);
  assert.equal((await request('/earn/claims')).status,401); // Normal session gate remains.
  const status=await (await request('/operations/status')).json();
  assert.equal(status.boundary,'application-only');assert.doesNotMatch(JSON.stringify(status),/invoice|incident-1|fixture drill/);
});
