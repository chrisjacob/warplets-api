import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityTransport } from '../src/capability-transport.mjs';
import { createClient } from '../../contracts/client.mjs';
import { makeCapabilities } from '../../contracts/capabilities.mjs';

function setup(runtime='workerd-local',exclude=[]) {
 const calls=[]; let time=0, broken=false;
 const transport=capabilityTransport({now:()=>time,fetchImpl:async(url,init)=>{
  calls.push([url,init?.method]);
  if(String(url).endsWith('/capabilities')) {
   if(broken)throw Error('offline');
   const data=makeCapabilities(runtime);data.features=data.features.filter(feature=>!exclude.includes(feature.id));return Response.json({data});
  }
  return Response.json({data:[],meta:{}});
 }});
 return {calls,transport,client:createClient({fetchImpl:transport.fetch}),
   advance:()=>{time+=30001;},breakDiscovery:()=>{broken=true;}};
}
test('restricted runtime allows mounted inventory and fixture mint requests but blocks unadvertised recovery reads',async()=>{
 const {calls,client}=setup('workerd-local',['transaction-receipt-preview']);
 await client.listLocalInventories();
 await client.reserveLocalMint({path:{id:'a',stage:'b'},idempotencyKey:'synthetic-capability-check',body:{expectedTermsDigest:'a'.repeat(64)}});
 await assert.rejects(client.getTransaction({path:{id:'unknown'}}),/unavailable/);
 assert.deepEqual(calls,[['/api/v1/capabilities','GET'],['/api/v1/collect/inventories','GET'],['/api/v1/collect/inventories/a/stages/b/reservations','POST']]);
});
test('Node routes remain usable and concurrent discovery is deduplicated',async()=>{
 const {calls,client}=setup('node-reference');
 await Promise.all([client.listLocalInventories(),client.getMyEarnSubmissions()]);
 assert.equal(calls.filter(([url])=>url.endsWith('/capabilities')).length,1);
 assert.equal(calls.length,3);
});
test('failed refresh holds dependent requests but permits public policy',async()=>{
 const fixture=setup();
 await fixture.client.listMarkets();
 fixture.advance();fixture.breakDiscovery();
 await assert.rejects(fixture.client.listMarkets(),/capabilities are unavailable/);
 await assert.rejects(fixture.client.listMarkets(),/capabilities are unavailable/);
 await fixture.client.getPolicy();
 assert.equal(fixture.calls.filter(([url])=>url==='/api/v1/markets').length,1);
 assert.equal(fixture.calls.filter(([url])=>url.endsWith('/capabilities')).length,2);
});
test('invalid or financially enabled inventories cannot enable routes',async()=>{
 const data=makeCapabilities('node-reference');data.production.broadcast=true;
 let requests=0;
 const transport=capabilityTransport({fetchImpl:async()=>{requests++;return Response.json({data});}});
 await assert.rejects(createClient({fetchImpl:transport.fetch}).listMarkets(),/capabilities are unavailable/);
 assert.equal(requests,1);
});
test('route parameters match one segment and methods remain exact',async()=>{
 const {transport,calls}=setup();
 await transport.fetch('/api/v1/markets/a',{method:'GET'});
 await assert.rejects(transport.fetch('/api/v1/markets/a/nested',{method:'GET'}),/unavailable/);
 await assert.rejects(transport.fetch('/api/v1/markets/a',{method:'POST'}),/unavailable/);
 assert.equal(calls.length,2);
});
test('aborted dependent request does not cancel shared discovery or issue its fetch',async()=>{
 const {transport,calls}=setup();
 await assert.rejects(transport.fetch('/api/v1/markets',{signal:AbortSignal.abort()}),{name:'AbortError'});
 await transport.fetch('/api/v1/markets');
 assert.equal(calls.length,2);
});


test('React boundaries omit unsupported child components and preserve supported content',async t=>{
 const {createServer}=await import('vite');
 const {createServer:createHttpServer}=await import('node:http');
 const hmrServer=createHttpServer();
 const {fileURLToPath}=await import('node:url');
 const {createElement}=await import('react');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:{server:hmrServer}},appType:'custom',logLevel:'error'});
 t.after(()=>vite.close());
 const {QueryClient,QueryClientProvider}=await import('@tanstack/react-query');
 const {Capability,principalKey}=await vite.ssrLoadModule('/src/capabilities.tsx');
 let mounts=0;
 function Child(){mounts++;return createElement('span',null,'Supported empty result');}
 for(const [runtime,expected] of [['workerd-local',false],['node-reference',true]]){
  const cache=new QueryClient();
  const cap=makeCapabilities(runtime);if(!expected)cap.features=cap.features.filter(feature=>feature.id!=='transaction-receipt-preview');
  cache.setQueryData(['runtime-capabilities','/api/v1',1],cap);
  const html=renderToStaticMarkup(createElement(QueryClientProvider,{client:cache},
   createElement(Capability,{path:'/api/v1/transactions/synthetic-operation'},createElement(Child))));
  assert.equal(html.includes('Supported empty result'),expected);
  assert.equal(html.includes('unavailable in the connected runtime'),!expected);
  cache.clear();
 }
 assert.equal(mounts,1,'unsupported components must not mount their hooks');
 for(const runtime of ['workerd-local','node-reference']){const cache=new QueryClient();cache.setQueryData(['runtime-capabilities','/api/v1',1],makeCapabilities(runtime));const html=renderToStaticMarkup(createElement(QueryClientProvider,{client:cache},createElement(Capability,{path:'/api/v1/collect/inventories'},createElement(Child))));assert.ok(html.includes('Supported empty result'));cache.clear();}
 assert.equal(mounts,3,'inventory children mount in both implemented runtimes');
 assert.deepEqual(principalKey('wallet-a','inventories'),['private','wallet-a','solana','inventories']);
 assert.deepEqual(principalKey(null,'inventories'),['public','solana','inventories']);
});

test('current Worker advertises and mounts owner recovery reads',async()=>{const {calls,client}=setup();await client.getTransaction({path:{id:'synthetic-intent'}});assert.deepEqual(calls,[['/api/v1/capabilities','GET'],['/api/v1/transactions/synthetic-intent','GET']]);});
