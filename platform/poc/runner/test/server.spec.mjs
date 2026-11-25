import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRunner} from '../server.mjs';
import {fixture} from './fixture.mjs';

test('loopback HTTP enforces host/origin/CSRF and exposes only typed operations',async()=>{
  const f=fixture();let started=0;
  const app=await createRunner({store:f.store,engine:f.engine,mode:'mock',port:0,jobs:{start:poc=>{started++;return {poc};}},identity:{commit:'mock',node:process.version}});
  try{
    const state=await(await fetch(app.origin+'/api/state')).json();assert.equal(state.mode,'mock');assert.equal(state.catalogue.length,11);
    const post=(path,headers={},body={poc:'P00'})=>fetch(app.origin+'/api/'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
    assert.equal((await post('checks')).status,403);
    assert.equal((await post('checks',{origin:'https://evil.test','x-poc-csrf':state.csrf})).status,403);
    assert.equal((await post('checks',{origin:app.origin,'x-poc-csrf':state.csrf})).status,202);assert.equal(started,1);
    const badHost=await new Promise(resolve=>{const req=http.get(app.origin+'/api/state',{headers:{host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',()=>resolve(0));});assert.equal(badHost,403);
    assert.equal((await post('rpc',{origin:app.origin,'x-poc-csrf':state.csrf})).status,404);
    assert.equal((await post('notes',{origin:app.origin,'x-poc-csrf':state.csrf},{poc:'P09',text:'Physical wallet not yet tested'})).status,200);assert.equal(f.store.value.notes[0].evidenceClass,'manual-unverified');
    const html=await fetch(app.origin);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(html.headers.get('cache-control'),'no-store');
    assert.match(await html.text(),/Disposable POC lab/);assert.equal((await fetch(app.origin+'/app.js')).status,200);
    assert.equal(f.control.sendCount,0);
  }finally{await new Promise(resolve=>app.server.close(resolve));f.store.close();}
});
