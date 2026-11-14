import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const origin=process.env.QA_IDENTITY_ORIGIN??'http://127.0.0.1:4183';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Use a local QA preview.');
const manifestPath=process.env.QA_IDENTITY_MANIFEST??'work/qa-public-identities-complete-2026-11-14/identities.json';
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const engine=process.env.BROWSER_ENGINE??'chromium',playwright=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const browser=await playwright[engine].launch({headless:true,...(process.env.BROWSER_EXE?{executablePath:process.env.BROWSER_EXE}:{})});
const evidence=process.env.QA_IDENTITY_EVIDENCE??'work/qa-identities-browser';mkdirSync(evidence,{recursive:true});
const results=[],external=[],errors=[];
try{
 for(const width of [320,1280]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});const page=await context.newPage();page.setDefaultTimeout(15000);
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin){external.push(url.href);return route.abort();}return route.continue();});
  page.on('pageerror',error=>errors.push(error.message));
  const visit=async path=>{const response=await page.goto(origin+path);assert.equal(response.status(),200,path);await page.locator('#view[aria-busy=false]').waitFor();await page.waitForLoadState('networkidle');};
  const bounded=async label=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,label+' overflows at '+width);
  const shot=async label=>{await bounded(label);await page.screenshot({path:evidence+'/'+label+'-'+width+'.png'});};
  const imagesLoaded=async selector=>{
   const images=page.locator(selector);assert.ok(await images.count()>0,selector+' missing');
   for(const image of await images.all()){if(!await image.isVisible())continue;await image.scrollIntoViewIfNeeded();await image.evaluate(img=>img.decode());assert.ok(await image.evaluate(img=>img.naturalWidth>0));}
   await page.evaluate(()=>window.scrollTo(0,0));
  };
  await visit('/tokens');assert.equal(await page.locator('meta[name="tenx-qa-public-identities"]').getAttribute('content'),'enabled');
  const overlay=await page.evaluate(async()=>{const r=await fetch('/api/v1/qa/identities');if(!r.ok)throw Error('Overlay unavailable');return r.json();});
  assert.equal(overlay.profiles.length,249);assert.equal(overlay.tokens.length,90);assert.ok(!overlay.profiles.some(p=>p.wallet===manifest.ownerWallet));
  assert.equal(await page.locator('.token-list-item').count(),10);
  const tokenById=new Map(overlay.tokens.map(t=>[t.tokenId,t]));
  for(const row of await page.locator('.token-list-item').all()){
   const href=await row.locator('a').first().getAttribute('href'),id=decodeURIComponent(href.split('/').at(-1)),token=tokenById.get(id);assert.ok(token,'Mapped token '+id);
   const text=await row.innerText();assert.ok(text.includes(token.name));assert.ok(text.includes(token.symbol));assert.match(text,/demo/);assert.equal(await row.locator('img').getAttribute('src'),token.image);
  }
  await imagesLoaded('.token-list-item img');await shot('tokens');await page.locator('.token-list-item').first().scrollIntoViewIfNeeded();await shot('token-list');
  await visit('/markets/'+overlay.tokens[0].tokenId);const token=overlay.tokens[0];
  assert.equal(await page.locator('h1').innerText(),token.name+' · '+token.symbol+' (demo)');assert.ok((await page.title()).includes(token.name));
  assert.equal(await page.locator('.qa-public-attribution a').getAttribute('href'),token.sourceUrl);assert.match(await page.locator('.qa-public-attribution').innerText(),/Prices and rewards remain demo data/);await imagesLoaded('.qa-public-art img');await shot('token-detail');
  for(const [path,label] of [['airdrops','Airdrops'],['nfts','NFTs'],['stake','Stake'],['earn','Earn']]){
  await visit('/'+path);const board=page.getByRole('region',{name:label+' performance leaderboard'});assert.equal(await board.locator('.performance-list > .performance-row').count(),10);
  const profileByWallet=new Map(overlay.profiles.map(p=>[p.wallet,p]));let checked=0;
  for(const row of await board.locator('.performance-list > .performance-row').all()){
   const href=await row.locator('.rank-identity a').getAttribute('href'),wallet=decodeURIComponent(href.split('/').at(-1)),profile=profileByWallet.get(wallet);
   if(!profile){assert.equal(wallet,manifest.ownerWallet);continue;}
   assert.ok((await row.locator('.rank-identity').innerText()).includes('@'+profile.username));assert.equal(await row.locator('img').getAttribute('src'),profile.image);assert.equal(await row.locator('img').isVisible(),true,'Profile image stays visible at '+width);checked++;
  }
  assert.ok(checked>=9);await imagesLoaded('.performance-list .qa-public-art img');await board.scrollIntoViewIfNeeded();await shot('leaderboard-'+path);
  }
  await visit('/participants/'+overlay.profiles[0].wallet);const profile=overlay.profiles[0];
  const heading=await page.locator('.qa-profile-heading h3').innerText();assert.ok(heading.includes(profile.displayName));assert.ok(heading.includes('@'+profile.username));assert.match(heading,/demo/);
  const notice=await page.locator('.qa-public-attribution').innerText();assert.match(notice,/This demo wallet and its activity are simulated/);assert.match(notice,/No affiliation/);assert.equal(await page.locator('.qa-public-attribution a').getAttribute('href'),profile.profileUrl);
  await imagesLoaded('.qa-profile-heading img');await shot('participant');
  await visit('/participants/'+manifest.ownerWallet);assert.equal(await page.locator('.qa-profile-heading .qa-public-name').count(),0);assert.equal(await page.locator('.qa-public-attribution').count(),0);
  const owner=await page.evaluate(async wallet=>{const r=await fetch('/api/v1/performance/profiles/'+wallet);return r.json();},manifest.ownerWallet);assert.equal((owner.data??owner).wallet,manifest.ownerWallet);await bounded('owner');
  if(width===1280){
   const refs=[...overlay.tokens,...overlay.profiles].map(item=>item.image);assert.equal(refs.length,339);assert.ok(refs.every(Boolean));const unique=[...new Set(refs)];assert.equal(unique.length,338);
   const decoded=await page.evaluate(async urls=>{let next=0;const results=[];await Promise.all(Array.from({length:8},async()=>{for(;;){const index=next++;if(index>=urls.length)return;const url=urls[index];try{const image=new Image();image.src=url;await image.decode();results.push({url,width:image.naturalWidth,height:image.naturalHeight,ok:image.naturalWidth>0&&image.naturalHeight>0});}catch(error){results.push({url,ok:false,error:String(error)});}}}));return results;},unique);
   writeFileSync(evidence+'/image-decodes-'+engine+'.json',JSON.stringify(decoded,null,2));assert.equal(decoded.length,338);assert.deepEqual(decoded.filter(image=>!image.ok),[],'Every cached image must decode');
  }
  results.push({engine,browser:browser.version(),width,publicTokenNames:true,tokenDetailDemoTitle:true,leaderboardPortraitsAndHandles:true,participantAttribution:true,ownerPreserved:true,noOverflow:true});await context.close();
 }
 assert.deepEqual(external,[],'Only local cached media and API requests allowed');assert.deepEqual(errors,[]);
 const report={passed:true,manifest:manifestPath,associatedImages:339,uniqueImagesDecoded:338,noExternalBrowserRequests:true,results};writeFileSync(evidence+'/results-'+engine+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close();}
