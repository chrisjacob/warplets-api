import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin=process.env.DARK_QA_ORIGIN??'http://127.0.0.1:4183',directory=process.env.DARK_QA_DIR??'work/dark-design';
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname));
const engine=process.env.BROWSER_ENGINE??'chromium',playwright=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const browser=await playwright[engine].launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});mkdirSync(directory,{recursive:true});const results=[];
try{for(const width of [320,390,1280]){
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const visit=async path=>{assert.equal((await page.goto(origin+path)).status(),200);await page.waitForLoadState('networkidle');await page.locator('#view[aria-busy=false]').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,path+' '+width);};
 const contrast=()=>page.evaluate(()=>{
  const rgb=s=>(s.match(/[\d.]+/g)??[]).map(Number),blend=(f,b,a)=>f.map((v,i)=>v*a+b[i]*(1-a));
  const luminance=channels=>channels.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  return [...document.querySelectorAll('h1,.page-hero p,.panel>h2,.fixture-label,.ranking-label,.primary-link,.wallet-button,.category-chips a,.collection-art figcaption strong,.rank-value,.journey p,nav[aria-label="Main navigation"] a')].filter(el=>el.getClientRects().length).map(el=>{
   let bg=[9,14,12],layers=[];for(let n=el;n;n=n.parentElement){const c=rgb(getComputedStyle(n).backgroundColor);if(c.length>=3)layers.push(c);}for(const c of layers.reverse())bg=blend(c.slice(0,3),bg,c[3]??1);
   const style=getComputedStyle(el),fg=rgb(style.color).slice(0,3),a=luminance(fg),b=luminance(bg);return {text:el.textContent?.slice(0,60),selector:el.className,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  });
 });
 for(const path of ['/','/tokens','/nfts','/airdrops','/stake','/earn','/collections/genesis']){
  await visit(path);assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'dark');
  if(path==='/'||path==='/nfts'||path==='/collections/genesis'){for(const image of await page.locator('.collection-art img').all()){await image.scrollIntoViewIfNeeded();await image.evaluate(img=>img.decode());assert.ok(await image.evaluate(img=>img.naturalWidth>0));}await page.evaluate(()=>window.scrollTo(0,0));}
  if(path==='/nfts'){assert.equal(await page.locator('.season-art-grid article').count(),5);assert.equal(await page.locator('.season-art-grid img').count(),5);await page.locator('.season-showcase').evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:directory+'/season-gallery-'+width+'.png'});await page.evaluate(()=>window.scrollTo(0,0));}
  if(path==='/collections/genesis')assert.equal(await page.locator('.collection-detail-art img').count(),1);
  const ratios=await contrast();assert.deepEqual(ratios.filter(r=>r.ratio<4.5),[],path+' text contrast');
  if(path==='/'){
   assert.equal(await page.getByRole('navigation',{name:'Explore categories'}).getByRole('link').count(),5);assert.equal(await page.locator('.hero-token-strip a').count(),3);
   await page.getByRole('navigation',{name:'Explore categories'}).getByRole('link',{name:'Tokens',exact:true}).focus();const outline=await page.evaluate(()=>getComputedStyle(document.activeElement).outlineWidth);assert.ok(parseFloat(outline)>=3);await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Tokens',level:1,exact:true}).waitFor();await visit('/');
  }
  await page.screenshot({path:directory+'/'+(path==='/'?'home':path.slice(1).replaceAll('/','-'))+'-'+width+'.png'});
  if(path==='/tokens'){await page.locator('.token-list-item').first().evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:directory+'/token-list-'+width+'.png'});}
 }
 await page.route('**/api/v1/collect/assets/concealed-art-fixture',route=>route.fulfill({status:200,json:{data:{id:'concealed-art-fixture',inventoryId:'demo-season',owner:'demo',revealStatus:'unrevealed'},meta:{requestId:'synthetic-concealed',policyVersion:'prd-1.2',asOf:'2026-11-14T00:00:00.000Z',sourceSlot:null}}}));await page.evaluate(()=>{history.pushState({},'','/nfts/concealed-art-fixture');window.dispatchEvent(new PopStateEvent('popstate'));});await page.locator('.is-concealed').waitFor();assert.equal(await page.locator('.is-concealed img').count(),0);await page.screenshot({path:directory+'/concealed-'+width+'.png'});
 await page.locator('#wallet-button').focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog');await dialog.waitFor();assert.equal(await dialog.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(18, 29, 23)');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.activeElement?.id),'wallet-button');
 assert.deepEqual(errors,[]);results.push({engine,width,darkTheme:true,allSeasonArtDecoded:true,concealedArtHidden:true,genesisWarpletDecoded:true,sampledTextContrastAtLeast4_5:true,categoryChipsKeyboard:true,focusRing:true,dialogEscapeAndReturn:true,noOverflow:true});await context.close();
}writeFileSync(directory+'/results-'+engine+'.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));}finally{await browser.close();}
