import {checkCollectionDetails} from './collections-qa.mjs';
import {checkMemberEvidence} from './member-evidence-qa.mjs';
import {checkCollectionEdges} from './collection-edges-qa.mjs';
import {checkFinancialCursors} from './financial-cursors-qa.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { serveSite } from '../serve.mjs';
import { createApp } from '../../server/application.mjs';
import { createLocalServer } from '../../server/start.mjs';
import { openDatabase } from '../../storage/database.mjs';
import { checkMemberPages } from '../../web/member-smoke.mjs';
import { checkStandardWallet } from './standard-wallet.mjs';
import { checkRuntimeProfiles } from './runtime-qa.mjs';
import { checkQuoteView } from './quote-qa.mjs';
import {memoryArtifacts} from '../../application/fixtures/memory-artifacts.mjs';

if(!process.env.PLAYWRIGHT_MODULE || !process.env.BROWSER_EXE) throw Error('Set PLAYWRIGHT_MODULE and BROWSER_EXE to local installations.');
await stat(new URL('../dist/index.html',import.meta.url));
const artifactStore=memoryArtifacts(),db=openDatabase(':memory:'),api=createApp(db,{artifactStore});
const server=createLocalServer(async(request,peer)=>await serveSite(request,undefined,path=>
  api(new Request(new URL(path,request.url)),peer))??api(request,peer));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  const newPage=browser.newPage.bind(browser),newContext=browser.newContext.bind(browser);
  browser.newPage=async options=>{const page=await newPage(options);await page.addInitScript(()=>sessionStorage.setItem('10x:technical','true'));return page;};
  browser.newContext=async options=>{const context=await newContext(options);await context.addInitScript(()=>sessionStorage.setItem('10x:technical','true'));return context;};
  const onlyQuotes=process.argv.includes('--only-quotes');
  for(const width of onlyQuotes?[]:[360,390,768,1440]){
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    for(const section of ['Tokens','Airdrops','NFTs','Attention','Leaderboards']){
      await page.goto(origin+'/'+section.toLowerCase());
      await page.getByRole('heading',{name:section,level:1}).waitFor();
      await page.locator('#view[aria-busy=false]').waitFor();
      assert.equal(await page.locator('nav [aria-current=page]').getAttribute('href'),'/'+section.toLowerCase());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Overflow: '+width+' '+section);
      assert.equal(await page.getByText('This response did not match the expected data format.').count(),0,'API shape: '+section);
      if(section==='Tokens'){
        await page.locator('#curve-seconds').focus();await page.keyboard.press('End');
        assert.equal(await page.locator('#curve-value').textContent(),'1%');
        await page.keyboard.press('Home');assert.equal(await page.locator('#curve-value').textContent(),'90%');
        await page.locator('#wallet-button').click();await page.locator('#wallet-dialog').waitFor();
        await page.keyboard.press('Escape');await page.locator('#wallet-dialog').waitFor({state:'hidden'});
        assert.equal(await page.evaluate(()=>document.activeElement.id),'wallet-button');
      }
      if(process.env.SCREENSHOT_DIR){
        await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:join(process.env.SCREENSHOT_DIR,section.toLowerCase()+'-'+width+'.png')});
      }
      console.log(width+'px '+section+' passed');
    }
    // Client-side routing and browser Back must both restore the correct page.
    await page.getByRole('navigation').getByRole('link',{name:'Tokens'}).click();
    await page.getByRole('heading',{level:1,name:'Tokens'}).waitFor();
    await page.goBack();
    await page.getByRole('heading',{level:1,name:'Leaderboards'}).waitFor();
    assert.deepEqual(errors,[]);await page.close();
  }
  if(!onlyQuotes){
  await checkMemberPages({browser,db,origin});
  const details=await browser.newPage();
  for(const [path,heading,publicText] of [
    ['/markets/browser-att','BROWSERATT / BROWSEROG','Campaign status'],
    ['/collections/genesis','Genesis','10,000'],
    ['/seasons/browser-season','Season · browser-season','Season start'],
    ['/nfts/browser-s1','browser-s1','Revealed metadata'],
    ['/earn/2026-11-01','Leaderboards','Awaiting final scores'],
  ]){
    const resp=await details.goto(origin+path);
    assert.equal(resp.status(),200,path);
    const initial=await resp.text();
    assert.ok(initial.includes(publicText) || initial.includes('Level'),path+' lacks initial public data');
    await details.getByRole('heading',{name:heading,level:1}).waitFor();
    assert.equal(await details.locator('link[rel=canonical]').getAttribute('href'),origin+path);
  }
  const missing=await details.goto(origin+'/nfts/no-such-asset');
  assert.equal(missing.status(),404);
  const imageResponse=await details.request.get(origin+'/social-card.png');
  assert.equal(imageResponse.status(),200);assert.ok((await imageResponse.body()).subarray(1,4).toString()==='PNG');
  const privatePage=await details.request.get(origin+'/collect?receipt=private-test');
  assert.match(privatePage.headers()['x-robots-tag'],/noindex, nofollow/);
  assert.ok(!(await privatePage.text()).includes('private-test'));
  await details.close();
  console.log('Canonical routes, public initial HTML, privacy tags, social image and real 404s passed.');
  await checkCollectionDetails({browser,db,origin});
  await checkMemberEvidence({browser});
  await checkCollectionEdges({browser});
  await checkFinancialCursors({browser});
  await checkStandardWallet({browser,db,origin});
  await checkRuntimeProfiles({browser,origin});
  }
  await checkQuoteView({browser,db,origin,artifactStore});
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();
}
