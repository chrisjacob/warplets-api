import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {openDatabase} from '../../storage/database.mjs';
import {seedDemo} from '../../scripts/demo-data.mjs';
import {createApp} from '../../server/application.mjs';
import {createLocalServer} from '../../server/start.mjs';
import {createHash} from 'node:crypto';
const engine=process.env.BROWSER_ENGINE??'chromium',playwright=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE),db=openDatabase();const f=seedDemo(db),server=createLocalServer(createApp(db));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const token='synthetic-mobile-keyboard-review';db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),f.wallet,origin,Date.now()+600000);
const browser=await playwright[engine].launch({...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{}),headless:true});const results=[];mkdirSync('work/navigation-review',{recursive:true});
try{
 for(const width of [320,390,844,1280]){
  db.prepare('DELETE FROM request_limits').run();
  const context=await browser.newContext({viewport:{width,height:900}});
  context.setDefaultTimeout(15000);
  await context.addCookies([{name:'tenx_local_session',value:token,url:origin,httpOnly:true,sameSite:'Strict'}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const visit=async url=>{const response=await page.goto(url);await page.waitForLoadState('networkidle');await page.locator('#view[aria-busy=false]').waitFor();return response;};
  for(const [path,title] of [['tokens','Tokens'],['nfts','NFTs'],['airdrops','Airdrops'],['stake','Stake'],['earn','Earn'],['leaderboards','Daily content scores']]){
   const response=await visit(origin+'/'+path);assert.equal(response.status(),200);
   await page.getByRole('heading',{name:title,level:1,exact:true}).waitFor();await page.locator('#view[aria-busy=false]').waitFor();
   assert.deepEqual(await page.locator('nav[aria-label="Main navigation"] a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))),['Home','Tokens','NFTs','Airdrops','Stake','Earn']);
   assert.equal(await page.locator('nav [aria-current=page]').getAttribute('href'),'/'+(path==='leaderboards'?'earn':path));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,path+' overflow at '+width);
   if(path==='earn'){
    assert.equal(await page.locator('#submission-form').count(),1);assert.equal(await page.locator('#board-date').count(),0);
    await page.getByRole('link',{name:'Stake DEMOATT to participate →',exact:true}).click();
    assert.equal(new URL(page.url()).searchParams.get('farm'),'demo-att');await page.getByRole('heading',{name:'Stake',level:1}).waitFor();await page.goBack();
   }
   if(path==='leaderboards'){
    assert.equal(await page.locator('#submission-form').count(),0);
    await page.locator('#board-date').fill('2026-11-11');await page.getByRole('button',{name:'View board',exact:true}).click();
    await page.waitForURL('**/leaderboards?date=2026-11-11');await page.reload();assert.equal(await page.locator('#board-date').inputValue(),'2026-11-11');
    await page.getByRole('link',{name:'Submit content →',exact:true}).click();await page.getByRole('heading',{name:'Earn',level:1}).waitFor();
   }
  }
  await visit(origin+'/tokens');await page.getByRole('link',{name:'Stake DEMOATT →',exact:true}).click();await page.getByRole('heading',{name:'Stake',level:1}).waitFor();assert.equal(new URL(page.url()).searchParams.get('farm'),'demo-att');
  await visit(origin+'/markets/demo-att');await page.getByRole('link',{name:'Stake this token →',exact:true}).click();assert.equal(new URL(page.url()).searchParams.get('farm'),'demo-att');
  await visit(origin+'/attention');await page.locator('#wallet-button').click();await page.getByRole('link',{name:'My stakes →',exact:true}).click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});await page.getByRole('heading',{name:'Stake',level:1}).waitFor();
  for(const [path,title] of [['markets','Tokens'],['vault','Airdrops'],['collect','NFTs'],['earn','Earn'],['earn/2026-11-11','Daily content scores']]){
   const response=await visit(origin+'/'+(path==='leaderboards'?'earn':path));assert.equal(response.status(),200);await page.getByRole('heading',{name:title,level:1,exact:true}).waitFor();
  }
  await visit(origin+'/tokens');await page.locator('#view[aria-busy=false]').waitFor();await page.screenshot({path:'work/navigation-review/tokens-'+width+'.png',fullPage:true});
  assert.deepEqual(errors,[]);results.push({width,navigation:true,contextualStaking:true,walletMenu:true,legacyLinks:true,boardDateReload:true});await context.close();
 }
 const guest=await browser.newPage();await guest.goto(origin+'/attention');await guest.getByRole('heading',{name:'Earn',level:1}).waitFor();assert.equal(await guest.locator('#submission-form').count(),0);await guest.getByRole('link',{name:'Explore tokens and staking →'}).waitFor();await guest.close();
 writeFileSync('work/navigation-review/navigation-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
