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
const server=createLocalServer(createApp(db,{performanceService:createPerformanceService(snapshot)}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port,token='synthetic-stake-pagination';
db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),DEFAULT_QA_OWNER,origin,Date.now()+1800000);
const engine=process.env.BROWSER_ENGINE??'chromium',playwright=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE),browser=await playwright[engine].launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})}),evidence=process.env.PERFORMANCE_QA_DIR??'work/performance-ui';mkdirSync(evidence,{recursive:true});const results=[];
const unwrap=async response=>{assert.equal(response.status(),200);const value=await response.json();return value.data??value;};
try{
 for(const width of [320,390,1280]){
  db.prepare('DELETE FROM request_limits').run();const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});context.setDefaultTimeout(15000);await context.addCookies([{name:'tenx_local_session',value:token,url:origin,httpOnly:true,sameSite:'Strict'}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const query=()=>new URL(page.url()).searchParams;
  await page.goto(origin+'/stake?farm=qa-att-001');await page.waitForLoadState('networkidle');await page.locator('#view[aria-busy=false]').waitFor();
  assert.equal(await page.locator('.stake-campaigns>li').count(),6);assert.equal(await page.locator('.stake-positions>article').count(),6);
  while(await page.getByRole('button',{name:/Show more campaigns/}).count())await page.getByRole('button',{name:/Show more campaigns/}).click();assert.equal(await page.locator('.stake-campaigns>li').count(),25);
  const firstPage=await page.locator('.stake-campaigns a').evaluateAll(nodes=>nodes.map(n=>new URL(n.href).searchParams.get('farm'))),positionFirst=await page.locator('.stake-positions h3').first().innerText();await page.getByRole('button',{name:/Show more positions/}).click();assert.equal(await page.locator('.stake-positions>article').count(),12);
  const catalogResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/markets'&&new URL(r.url()).searchParams.has('cursor'));await page.getByRole('link',{name:'Next campaigns →',exact:true}).click();const nextCatalog=await unwrap(await catalogResponse);assert.equal(nextCatalog.items.length,25);const campaignCursor=query().get('campaigns');assert.ok(campaignCursor);assert.equal(query().get('cursor'),null);assert.equal(query().get('farm'),'qa-att-001');assert.ok(nextCatalog.items.every(item=>!firstPage.includes(item.id)));
  await page.locator('.stake-campaigns strong').filter({hasText:nextCatalog.items[0].symbol}).waitFor();assert.equal(await page.locator('.stake-campaigns>li').count(),6);assert.equal(await page.locator('.stake-positions>article').count(),12);assert.equal(await page.locator('.stake-positions h3').first().innerText(),positionFirst);
  const positionsResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/stake/positions'&&new URL(r.url()).searchParams.has('cursor'));await page.getByRole('link',{name:'Next positions →',exact:true}).click();const nextPositions=await unwrap(await positionsResponse);assert.equal(nextPositions.items.length,25);const positionsCursor=query().get('cursor');assert.ok(positionsCursor);assert.equal(query().get('campaigns'),campaignCursor);assert.equal(query().get('farm'),'qa-att-001');await page.locator('.stake-positions h3').filter({hasText:nextPositions.items[0].marketId}).waitFor();assert.equal(await page.locator('.stake-positions>article').count(),6);assert.equal(await page.locator('.stake-campaigns>li').count(),6);
  await page.locator('.stake-campaigns a').first().click();assert.equal(query().get('farm'),nextCatalog.items[0].id);assert.equal(query().get('campaigns'),campaignCursor);assert.equal(query().get('cursor'),positionsCursor);await page.reload();await page.waitForLoadState('networkidle');await page.locator('#view[aria-busy=false]').waitFor();assert.equal(await page.locator('.stake-campaigns>li').count(),6);assert.equal(await page.locator('.stake-positions>article').count(),6);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:evidence+'/stake-pagination-'+width+'.png',fullPage:true});
  await page.getByRole('link',{name:'First campaigns →',exact:true}).click();await page.locator('.stake-campaigns strong').filter({hasText:'QAATT001'}).waitFor();assert.equal(query().get('campaigns'),null);assert.equal(query().get('cursor'),positionsCursor);assert.equal(query().get('farm'),nextCatalog.items[0].id);assert.equal(await page.locator('.stake-campaigns>li').count(),6);
  await page.goto(origin+'/markets/qa-att-040');await page.getByRole('link',{name:'Stake this token →',exact:true}).click();assert.equal(query().get('farm'),'qa-att-040');await page.getByRole('heading',{level:1,name:'Stake',exact:true}).waitFor();await page.waitForLoadState('networkidle');assert.equal(await page.locator('.stake-campaigns>li').count(),6);assert.deepEqual(errors,[]);
  results.push({width,catalogPageSize:25,initialCampaigns:6,nextCatalogFirst:nextCatalog.items[0].id,positionPageSize:25,independentCursors:true,preservedFarm:true,reload:true,tokenDetailLink:true,noOverflow:true});await context.close();
 }
 writeFileSync(evidence+'/stake-pagination-'+engine+'.json',JSON.stringify({engine,version:browser.version(),results},null,2));console.log(JSON.stringify({engine,version:browser.version(),results}));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
