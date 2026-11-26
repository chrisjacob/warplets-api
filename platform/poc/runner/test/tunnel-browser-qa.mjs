import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import {createRunner} from '../server.mjs';
import {fixture} from './fixture.mjs';

if(!process.env.PLAYWRIGHT_MODULE||!process.env.BROWSER_EXE)throw Error('Set existing Playwright and browser paths');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const config={origin:'https://qa.example.test',prefix:'/poc',accessKey:randomBytes(32).toString('base64url')};
const f=fixture(),app=await createRunner({store:f.store,engine:f.engine,mode:'mock',port:0,tunnelConfig:config,identity:{commit:'mock'},jobs:{start:()=>({})}});
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',async route=>{
    const requested=route.request(),url=new URL(requested.url());
    if(url.origin!==config.origin)return route.abort();
    const result=await new Promise((yes,no)=>{
      const req=http.request(app.origin+url.pathname+url.search,{method:requested.method(),headers:{...requested.headers(),host:'qa.example.test','x-forwarded-proto':'https'}},res=>{
        const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>yes({status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,Array.isArray(v)?v.join('\n'):String(v)])),body:Buffer.concat(chunks)}));
      });req.on('error',no);req.end(requested.postDataBuffer()??undefined);
    });
    await route.fulfill(result);
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(config.origin+'/poc/');await page.getByRole('heading',{name:'Open your POC runner'}).waitFor();
  assert.equal(await page.evaluate(async()=> (await fetch('./api/export')).status),401);
  await page.goto(config.origin+'/poc/#access='+config.accessKey);await page.reload();
  await page.getByRole('heading',{name:'Disposable POC lab',exact:true}).waitFor();
  assert.equal(new URL(page.url()).hash,'');
  const cookie=(await context.cookies()).find(c=>c.name==='__Secure-poc-access');assert(cookie?.secure&&cookie.httpOnly);assert.equal(cookie.path,'/poc/');
  assert.equal(await page.evaluate(async()=> (await(await fetch('./api/state')).json()).access),'private-tunnel');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.reload();await page.getByRole('heading',{name:'Disposable POC lab',exact:true}).waitFor();
  assert.deepEqual(errors,[]);assert.equal(f.control.sendCount,0);
  console.log(JSON.stringify({passed:true,evidenceClass:'local-browser-mock',checks:['Unauthenticated evidence denied','Fragment access key exchanged for Secure HttpOnly cookie','Prefix assets and API load','Access key removed from address bar','390px layout and reload pass'],mainnetTransactions:0}));
}finally{await browser?.close();await new Promise(yes=>app.server.close(yes));f.store.close();}
