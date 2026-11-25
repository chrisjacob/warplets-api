import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
const playwright=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const origin=process.env.BRAND_QA_ORIGIN??'http://127.0.0.1:4182';
const out=process.env.SCREENSHOT_DIR??'work/consumer-design-2026-11-25/browser';
mkdirSync(out,{recursive:true});
const browser=await playwright.chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
const results=[],errors=[];
try{
 for(const width of [320,390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));
  const visit=async path=>{
   const r=await page.goto(origin+path);assert.equal(r.status(),200,path);
   await page.locator('#view[aria-busy=false]').waitFor();await page.evaluate(()=>document.fonts.ready);
   assert.equal(await page.locator('h1').count(),1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Overflow '+width+' '+path);
   assert.doesNotMatch(await page.locator('body').innerText(),/local preview|demonstration data|local test stages/i);
   results.push({width,path,words:(await page.locator('#view').innerText()).split(/\s+/).length});
  };
  await visit('/');
  assert.equal((await page.locator('h1').innerText()).replace(/\s+/g,' ').toUpperCase(),'10X EVERYTHING.');
  assert.equal(await page.evaluate(async()=>{const image=document.querySelector('.launch-photo');await image.decode();return image.naturalWidth>0&&document.fonts.check('900 32px "Barlow Condensed"');}),true,'Campaign artwork and display font load');
  assert.deepEqual(await page.locator('nav[aria-label="Main navigation"] a').allTextContents(),['Home','Tokens','Collect','Earn']);
  assert.equal(await page.locator('.mini-board').count(),0);
  assert.ok((await page.locator('#view').innerText()).split(/\s+/).length<220);
  await page.getByRole('link',{name:'Roadmap',exact:true}).click();
  await page.locator('#roadmap[open]').waitFor();await page.getByRole('heading',{name:'Start with one. Grow from there.'}).waitFor();
  await page.locator('#roadmap > summary').click();assert.equal(await page.locator('#roadmap').getAttribute('open'),null);
  await page.getByRole('link',{name:'Explore $10X',exact:true}).click();await page.waitForURL('**/tokens#tenx-meme');
  await page.locator('#view[aria-busy=false]').waitFor();assert.match(await page.locator('#tenx-meme').innerText(),/Not launched/);
  const market=await page.locator('.token-list-item a[href^="/markets/"]').first().getAttribute('href');
  assert.equal(await page.locator('.performance-board').count(),0,'Rankings should not mount until opened');
  await page.locator('#performance-tokens > summary').click();await page.getByRole('button',{name:'Market',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Market',exact:true}).getAttribute('aria-pressed'),'true');
  for(const path of ['/tokens','/nfts','/attention','/leaderboards','/airdrops','/stake','/earn','/markets','/collect','/vault','/collections/genesis',market].filter(Boolean))await visit(path);
  await visit('/nfts');
  assert.match(await page.locator('#season-0').innerText(),/US\$1\b/);
  await page.locator('#season-0 summary').click();await page.locator('#season-0').getByText('US$10',{exact:true}).waitFor();
  assert.match(await page.locator('#season-0').innerText(),/US\$10\b/);
  assert.match(await page.locator('#season-0').innerText(),/90%/);
  assert.match(await page.locator('#season-0').innerText(),/Dates to be confirmed/);
  const season=await page.locator('a[href^="/seasons/"]').first().getAttribute('href');if(season)await visit(season);
  await visit('/attention');assert.equal((await page.locator('h1').innerText()).toUpperCase(),'EARN');
  await page.getByText('How to participate',{exact:true}).click();
  await page.getByRole('button',{name:'Preview scoring feedback'}).click();await page.getByRole('heading',{name:/Suggested score/}).waitFor();
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  await visit('/');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Skip to content');
  await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'main');
  await page.locator('#wallet-button').click();await page.locator('#wallet-dialog').waitFor();
  await page.keyboard.press('Escape');await page.locator('#wallet-dialog').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'wallet-button');
  for(const [name,path] of [['home','/'],['collect','/nfts'],['earn','/earn'],['rewards','/airdrops']]){
   await visit(path);await page.screenshot({path:out+'/'+name+'-'+width+'.png',fullPage:true});
  }
  await page.close();console.log(width+'px consumer design, navigation, disclosures, pricing and keyboard checks passed');
 }
 assert.deepEqual(errors,[]);writeFileSync(out+'/results.json',JSON.stringify({origin,results,errors},null,2));
}finally{await browser.close();}
