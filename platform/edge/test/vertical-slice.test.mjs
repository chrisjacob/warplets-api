import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostedRuntime} from '../../scripts/hosted-runtime.mjs';
import {createHostedSlice} from '../../application/fixtures/hosted-slice.mjs';
test('same-origin hosted workerd admits signed synthetic contributors, settles fenced jobs, publishes and restores fresh instances',async t=>{
 const runtime=await createHostedRuntime();t.after(()=>runtime.close());
 const fixture=await createHostedSlice(runtime),result=await fixture.verify();
 assert.equal(result.nodeD1Parity,true);assert.equal(result.financialExecution,false);assert.equal(result.providerCalls,0);
 console.log('B20 synthetic hosted transcript '+JSON.stringify(result));
});
