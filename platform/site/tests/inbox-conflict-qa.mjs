import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash,randomBytes} from 'node:crypto';
import {openDatabase} from '../../storage/database.mjs';
import {createApp} from '../../server/application.mjs';
import {createLocalServer} from '../../server/start.mjs';
import {encode58} from '../../server/base58.mjs';
const engine=process.env.BROWSER_ENGINE??'chromium';
const playwright=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const browser=await playwright[engine].launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
try{for(const width of [390,1280]){
 const db=openDatabase(),server=createLocalServer(createApp(db));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const wallet=encode58(randomBytes(32)),token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),wallet,origin,Date.now()+600000);
 const context=await browser.newContext({viewport:{width,height:844}});await context.addCookies([{name:'tenx_local_session',value:token,url:origin,httpOnly:true,sameSite:'Strict'}]);const page=await context.newPage();page.setDefaultTimeout(10000);
 let delayRead=false,releaseRead,capturedRead,readCaptured=new Promise(r=>capturedRead=r),pendingPost=false;const posts=[];
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();if(url.pathname==='/api/v1/notifications/subscriptions'){
  if(req.method()==='POST'){posts.push({body:req.postDataJSON(),key:req.headers()['idempotency-key']});if(pendingPost){pendingPost=false;return route.fulfill({status:202,json:{kind:'pending',reason:'synthetic-test-dependency',dependencyIds:[]}});}}
  if(req.method()==='GET'&&delayRead){delayRead=false;const response=await route.fetch();capturedRead();await new Promise(r=>releaseRead=r);try{return await route.fulfill({response});}catch{return;}}
 }return route.continue();});
 try{
  await page.goto(origin+'/markets');await page.locator('#view[aria-busy=false]').waitFor();await page.locator('#wallet-button').click();await page.getByText('Local inbox settings',{exact:true}).click();await page.getByRole('button',{name:'Enable local inbox',exact:true}).waitFor();
  delayRead=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await readCaptured;
  await page.getByLabel('Market launches',{exact:true}).check();await page.getByRole('button',{name:'Enable local inbox',exact:true}).click();await page.getByRole('button',{name:'Turn off and clear inbox',exact:true}).waitFor();releaseRead();
  await page.getByRole('button',{name:'Turn off and clear inbox',exact:true}).click();await page.getByRole('button',{name:'Enable local inbox',exact:true}).waitFor();assert.deepEqual(posts.map(p=>p.body.expectedRevision),[0,1]);assert.equal(db.prepare('SELECT enabled FROM notice_preferences').get().enabled,0);
  await page.getByLabel('Market launches',{exact:true}).check();await page.getByRole('button',{name:'Enable local inbox',exact:true}).click();await page.getByRole('button',{name:'Turn off and clear inbox',exact:true}).waitFor();
  // Another tab changes consent through the actual API while this view stays stale.
  const external=await page.request.post(origin+'/api/v1/notifications/subscriptions',{headers:{origin,'idempotency-key':'synthetic-other-tab'},data:{channel:'local-inbox',terms:'10x-notice-local-inbox-v1',enabled:true,topics:['voting'],expectedRevision:3}});assert.equal(external.status(),200);
  await page.getByRole('button',{name:'Turn off and clear inbox',exact:true}).click();await page.getByRole('button',{name:'Refresh saved preferences',exact:true}).waitFor();assert.equal(db.prepare('SELECT revision FROM notice_preferences').get().revision,4);
  const count=posts.length;await page.getByRole('button',{name:'Refresh saved preferences',exact:true}).click();await page.getByRole('button',{name:'Refresh saved preferences',exact:true}).waitFor({state:'hidden'});assert.equal(await page.getByLabel('Genesis votes',{exact:true}).isChecked(),true);assert.equal(await page.getByLabel('Market launches',{exact:true}).isChecked(),false);assert.equal(posts.length,count,'Refresh must not retry consent automatically');
  await page.getByRole('button',{name:'Turn off and clear inbox',exact:true}).click();await page.getByRole('button',{name:'Enable local inbox',exact:true}).waitFor();assert.equal(posts.at(-1).body.expectedRevision,4);assert.equal(db.prepare('SELECT enabled FROM notice_preferences').get().enabled,0);
  // A non-final response cannot be mistaken for accepted consent or discard its key.
  pendingPost=true;await page.getByLabel('Market launches',{exact:true}).check();await page.getByRole('button',{name:'Enable local inbox',exact:true}).click();await page.getByRole('button',{name:'Refresh saved preferences',exact:true}).waitFor();const held=posts.at(-1);assert.equal(db.prepare('SELECT enabled FROM notice_preferences').get().enabled,0);
  await page.getByRole('button',{name:'Refresh saved preferences',exact:true}).click();await page.getByRole('button',{name:'Refresh saved preferences',exact:true}).waitFor({state:'hidden'});await page.getByLabel('Market launches',{exact:true}).check();await page.getByRole('button',{name:'Enable local inbox',exact:true}).click();await page.getByRole('button',{name:'Turn off and clear inbox',exact:true}).waitFor();assert.equal(posts.at(-1).key,held.key,'Unresolved request must retain its idempotency key');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  console.log(JSON.stringify({engine,browser:browser.version(),width,delayedRead:true,rapidEnableDisable:true,otherTabConflict:true,explicitRefresh:true,noAutomaticRetry:true,pendingKeyRetained:true,passed:true}));
 }finally{releaseRead?.();await context.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
}}finally{await browser.close();}
