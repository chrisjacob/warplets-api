import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCapabilities} from './capabilities.mjs';
import {openapi} from '../server/api.mjs';
import {openDatabase} from '../storage/database.mjs';
import {createApp} from '../server/application.mjs';
import {createClient} from './client.mjs';

test('runtime inventories describe only scoped local routes and never advertise financial execution',()=>{
 const node=makeCapabilities('node-reference'),worker=makeCapabilities('workerd-local'),spec=openapi();
 assert.throws(()=>makeCapabilities('mainnet'),/Unknown/);
 for(const cap of [node,worker]) {
   assert.equal(cap.mode,'local-validation');assert.equal(cap.walletAuthentication,'message-only');
   assert.equal(cap.externalNotifications,false);
   assert.ok(Object.values(cap.production).every(value=>value===false));
   assert.equal(new Set(cap.features.map(f=>f.id)).size,cap.features.length);
   for(const f of cap.features)for(const r of f.routes) {
     assert.ok(!r.path.includes('/transactions/prepare')&&!r.path.includes('/deposit'));
     if(r.path==='/api/v1/openapi.json'||r.path==='/api/v1/manifests/{digest}')continue;
     assert.ok(spec.paths[r.path.slice(7)]?.[r.method.toLowerCase()],`${cap.runtime} advertised absent route ${r.method} ${r.path}`);
   }
 }
 assert.ok(node.features.some(f=>f.id==='earn-admission'));
 assert.ok(worker.features.some(f=>f.id==='earn-admission'));
 assert.ok(worker.features.some(f=>f.id==='earn-actions'));
 assert.ok(worker.features.some(f=>f.id==='quote-preview'));
 assert.ok(!worker.features.some(f=>['local-inbox','collection-fixture-requests'].includes(f.id)));
 assert.ok(worker.features.some(f=>f.id==='verified-manifest-read'));
 const advertised=new Set(node.features.flatMap(f=>f.routes.map(r=>r.method+' '+r.path.slice(7))));
 for(const [path,item] of Object.entries(spec.paths))for(const method of ['get','post','put','patch','delete']){
   if(item[method])assert.ok(advertised.has(method.toUpperCase()+' '+path),'Missing Node capability '+method+' '+path);
 }
 node.features[0].routes[0].path='/altered';
 assert.equal(makeCapabilities('node-reference').features[0].routes[0].path,'/api/v1/capabilities');
});

test('anonymous Node discovery is available through generated client and cannot be written',async t=>{
 const db=openDatabase();t.after(()=>db.close());const app=createApp(db);
 const client=createClient({baseUrl:'http://localhost/api/v1',fetchImpl:(url,init)=>app(new Request(url,init))});
 const result=await client.getCapabilities();
 assert.deepEqual(result.data,makeCapabilities('node-reference'));
 assert.equal(result.meta.policyVersion,openapi().info.version);
 const denied=await app(new Request('http://localhost/api/v1/capabilities',{method:'POST'}));
 assert.equal(denied.status,405);
});
