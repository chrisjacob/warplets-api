import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalServer } from './start.mjs';

test('local API contract, planned inventory and unsupported writes',async t=>{
  const server=createLocalServer(); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port+'/api/v1';
  const spec=await (await fetch(base+'/openapi.json')).json();
  for(const path of Object.keys(spec.paths)) {
    if(path.includes('{')) continue;
    const response=await fetch(base+path); assert.equal(response.status,200,path); assert.ok(response.headers.get('x-request-id'));
  }
  const terms=await (await fetch(base+'/policy')).json();
  assert.equal(Object.values(terms.launch.allocationBps).reduce((a,b)=>a+b),10000);
  assert.equal(terms.operations.exceptionCeilingUsd,'30');
  const collections=await (await fetch(base+'/collections')).json();
  assert.ok(collections.items.every(item=>item.status==='planned'));
  assert.equal((await fetch(base+'/transactions',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/arbitrary')).status,404);
});
