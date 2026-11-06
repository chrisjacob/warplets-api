import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {costPacket} from '../../costs/packet.mjs';
import {costPacketFixtures} from '../../costs/packet.fixtures.mjs';
test('actual workerd portable calculator matches Node exact fourteen-scenario reports without Node compatibility or storage',async t=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('./fixtures/cost-packet-worker.ts',import.meta.url))],bundle:true,platform:'browser',format:'esm',write:false,target:'es2022',metafile:true});assert.ok(!Object.keys(bundle.metafile.inputs).some(p=>p.startsWith('node:')));assert.ok(!bundle.outputFiles[0].text.includes('node:crypto'));const mf=new Miniflare({workers:[{config:{name:'synthetic-cost-calculator',type:'worker',compatibilityDate:'2026-08-25',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:bundle.outputFiles[0].text}}}}}]});t.after(()=>mf.dispose());let calls=0,maxInput=0,maxOutput=0;
 async function run(input,fault){const r=await mf.dispatchFetch('http://localhost/test',{method:'POST',body:JSON.stringify({input,fault})});assert.equal(r.status,200);const body=await r.json();assert.ok(!body.error,JSON.stringify(body));calls++;maxInput=Math.max(maxInput,body.metrics.inputBytes);maxOutput=Math.max(maxOutput,body.metrics.outputBytes);assert.equal(body.metrics.hashes,1);assert.deepEqual(body.result,JSON.parse(JSON.stringify(costPacket(input))));assert.equal(body.result.scenarios.length,14);return body;}
 for(const input of Object.values(costPacketFixtures()))await run(input);await run(costPacketFixtures().complete,'mutation');t.diagnostic(JSON.stringify({calls,maxInput,maxOutput,bundleBytes:bundle.outputFiles[0].contents.length,storageCalls:0,financialExecution:false}));
});
