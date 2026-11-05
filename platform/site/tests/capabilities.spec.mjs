import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilityTransport } from '../src/capability-transport.mjs';
import { createClient } from '../../contracts/client.mjs';
import { makeCapabilities } from '../../contracts/capabilities.mjs';

function setup(runtime='workerd-local') {
 const calls=[]; let time=0, broken=false;
 const transport=capabilityTransport({now:()=>time,fetchImpl:async(url,init)=>{
  calls.push([url,init?.method]);
  if(String(url).endsWith('/capabilities')) {
   if(broken)throw Error('offline');
   return Response.json({data:makeCapabilities(runtime)});
  }
  return Response.json({data:[],meta:{}});
 }});
 return {calls,transport,client:createClient({fetchImpl:transport.fetch}),
   advance:()=>{time+=30001;},breakDiscovery:()=>{broken=true;}};
}
test('Worker blocks unsupported reads and writes before issuing a request',async()=>{
 const {calls,client}=setup();
 await assert.rejects(client.listLocalInventories(),/unavailable/);
 await assert.rejects(client.reserveLocalMint({path:{id:'a',stage:'b'},body:{}}),/unavailable/);
 await assert.rejects(client.getTransaction({path:{id:'unknown'}}),/unavailable/);
 assert.deepEqual(calls,[['/api/v1/capabilities','GET']]);
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
