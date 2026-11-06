import test from 'node:test';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';import {build} from 'esbuild';import {Miniflare} from 'miniflare';
import {costPacketFixtures} from '../../costs/packet.fixtures.mjs';import {executionContextId} from '../../costs/packet.mjs';
import {calculateCostComparisons} from '../../costs/packet-core.mjs';import {scenarioCashflow} from '../../costs/scenario-cashflow.mjs';
test('actual Worker comparison branches and conservative rent projection preserve Node results',async t=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('./fixtures/cost-comparison-worker.ts',import.meta.url))],bundle:true,platform:'browser',format:'esm',write:false,target:'es2022'});
 const mf=new Miniflare({workers:[{config:{name:'synthetic-cost-comparisons',type:'worker',compatibilityDate:'2026-08-25',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}}}}]});t.after(()=>mf.dispose());let calls=0;
 for(const input of Object.values(costPacketFixtures()))for(const kind of ['pending','empty-recorded','recipients-recorded']){
  const options={firstBoard:kind==='pending'?{kind}:{kind,evidenceDigest:'a'.repeat(64)},boardQuotes:{}};
  const comparisons=calculateCostComparisons(input,executionContextId(input.context),options);
  const response=await mf.dispatchFetch('http://localhost/test',{method:'POST',body:JSON.stringify({input,options})});assert.equal(response.status,200);
  assert.deepEqual(await response.json(),JSON.parse(JSON.stringify({comparisons,cashflow:scenarioCashflow(comparisons.oneClaim)})));calls++;
 }
 t.diagnostic(JSON.stringify({calls,storageCalls:0,financialExecution:false}));
});
