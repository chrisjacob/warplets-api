import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {createTunnelAccess} from '../tunnel-access.mjs';
import {createRunner} from '../server.mjs';
import {fixture} from './fixture.mjs';

test('tunnel sessions expire, cannot be forged, and are invalidated by access-key rotation',()=>{
  let time=1800000000000;
  const config={origin:'https://qa.example.test',prefix:'/poc',accessKey:randomBytes(32).toString('base64url')};
  const access=createTunnelAccess(config,()=>time);
  assert.equal(access.unlock('wrong'),null);
  const cookie=access.unlock(config.accessKey);assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);assert.match(cookie,/Path=\/poc\//);
  const request={headers:{cookie:cookie.split(';')[0]}};assert(access.authenticated(request));
  assert.equal(access.authenticated({headers:{cookie:request.headers.cookie+'x'}}),false);
  assert.equal(createTunnelAccess({...config,accessKey:randomBytes(32).toString('base64url')},()=>time).authenticated(request),false);
  time+=12*60*60*1000;assert.equal(access.authenticated(request),false);
  assert.throws(()=>createTunnelAccess({...config,origin:'http://qa.example.test'}),/Invalid tunnel/);
});

test('tunnel protects reads and mutations, scopes the route, and retains exact Origin/CSRF checks',async()=>{
  const f=fixture(),config={origin:'https://qa.example.test',prefix:'/poc',accessKey:randomBytes(32).toString('base64url')};
  const app=await createRunner({store:f.store,engine:f.engine,mode:'mock',port:0,tunnelConfig:config,identity:{commit:'test'},jobs:{start:()=>({status:'running'})}});
  const request=(path,method='GET',body,extra={})=>new Promise((yes,no)=>{
    const req=http.request(app.origin+path,{method,headers:{host:'qa.example.test','x-forwarded-proto':'https',...(method==='POST'?{origin:config.origin,'content-type':'application/json'}:{}),...extra}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>yes({status:res.statusCode,headers:res.headers,text}));});req.on('error',no);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  try {
    assert.equal((await request('/poc')).status,303);
    assert.match((await request('/poc/')).text,/Open your POC runner/);
    for(const path of ['/poc/api/state','/poc/api/export','/poc/app.js'])assert.equal((await request(path)).status,401);
    assert.equal((await request('/poc/api/prepare','POST',{action:'original'})).status,401);
    assert.equal((await request('/api/state')).status,404);
    assert.equal((await request('/poc/','GET',undefined,{'x-forwarded-proto':'http'})).status,403);
    assert.equal((await request('/poc/unlock','POST',{key:'wrong'})).status,401);
    assert.equal((await request('/poc/unlock','POST',{key:config.accessKey},{origin:'https://evil.example'})).status,403);
    const login=await request('/poc/unlock','POST',{key:config.accessKey});assert.equal(login.status,200);
    const cookie=login.headers['set-cookie'][0].split(';')[0];
    const state=await request('/poc/api/state','GET',undefined,{cookie});assert.equal(state.status,200);const data=JSON.parse(state.text);assert.equal(data.access,'private-tunnel');
    assert.match((await request('/poc/','GET',undefined,{cookie})).text,/Disposable POC lab/);
    assert.equal((await request('/poc/access.js','GET',undefined,{cookie})).status,200);
    assert.equal((await request('/poc/api/notes','POST',{poc:'P00',text:'test'},{cookie})).status,403);
    assert.equal((await request('/poc/api/notes','POST',{poc:'P00',text:'test'},{cookie,'x-poc-csrf':data.csrf})).status,200);
    assert.equal((await request('/poc/api/export','GET',undefined,{cookie})).status,200);
    const forwarded=await fetch(app.origin+'/api/state',{headers:{'x-forwarded-for':'198.51.100.7'}});assert.equal(forwarded.status,403);
    assert.equal(f.control.sendCount,0);
  }finally{await new Promise(yes=>app.server.close(yes));f.store.close();}
});
