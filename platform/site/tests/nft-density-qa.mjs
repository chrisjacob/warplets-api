import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openDatabase} from '../../storage/database.mjs';
import {createApp} from '../../server/application.mjs';
import {createLocalServer} from '../../server/start.mjs';
import {createPerformanceService} from '../../performance/leaderboards.mjs';
import {buildPerformanceScenario,DEFAULT_QA_OWNER} from '../../qa/scenario.mjs';
import {seedCoreScenario} from '../../qa/core.mjs';
const snapshot=buildPerformanceScenario({asOf:new Date(Math.floor(Date.now()/1000)*1000).toISOString()}),db=openDatabase();
seedCoreScenario(db,snapshot,{wallet:DEFAULT_QA_OWNER,mintCountPerSeason:60});
const server=createLocalServer(createApp(db,{performanceService:createPerformanceService(snapshot)}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,token='synthetic-nft-density';
db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),DEFAULT_QA_OWNER,origin,Date.now()+1800000);
const engine=process.env.BROWSER_ENGINE??'chromium',playwright=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE),browser=await playwright[engine].launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})}),evidence=process.env.PERFORMANCE_QA_DIR??'work/performance-ui';mkdirSync(evidence,{recursive:true});const results=[];
try{
 for(const width of [320,390,768,1280]){
  db.prepare('DELETE FROM request_limits').run();const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});context.setDefaultTimeout(15000);await context.addCookies([{name:'tenx_local_session',value:token,url:origin,httpOnly:true,sameSite:'Strict'}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/nfts');await page.waitForLoadState('networkidle');await page.locator('#view[aria-busy=false]').waitFor();
  assert.equal(await page.locator('.nft-card').count(),6);assert.equal(await page.locator('.published-inventory').count(),2);const more=page.getByRole('button',{name:/Show more collections/}),total=Number((await more.innerText()).match(/of (\d+)/)[1]);assert.ok(total>2);
  assert.equal(await page.locator('.nft-grid').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),width>=1100?3:width<=620?1:2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:evidence+'/nfts-'+width+'.png',fullPage:true});const pageHeight=await page.evaluate(()=>document.documentElement.scrollHeight);
  await more.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.published-inventory').count(),Math.min(4,total));
  await page.getByRole('button',{name:'Technical view',exact:true}).click();assert.equal(await page.locator('.published-inventory').count(),total);assert.equal(await page.locator('.nft-card').count(),25);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'Switch to simple view',exact:true}).click();await page.reload();await page.waitForLoadState('networkidle');await page.locator('#view[aria-busy=false]').waitFor();assert.equal(await page.locator('.published-inventory').count(),2);assert.equal(await page.locator('.nft-card').count(),6);assert.deepEqual(errors,[]);
  results.push({width,initialAssets:6,initialCollections:2,totalCollections:total,columns:width>=1100?3:width<=620?1:2,keyboardReveal:true,technicalUnchanged:true,pageHeight,noOverflow:true});await context.close();
 }
 writeFileSync(evidence+'/nft-density-'+engine+'.json',JSON.stringify({engine,version:browser.version(),results},null,2));console.log(JSON.stringify({engine,version:browser.version(),results}));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
