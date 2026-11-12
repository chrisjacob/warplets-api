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
try{for(const [width,height] of [[320,568],[390,844],[844,390],[1280,900]]){
// Reset only the disposable fixture's rate window between independent viewport cases.
db.prepare('DELETE FROM request_limits').run();console.log('Starting viewport',width,height);const context=await browser.newContext({viewport:{width,height},reducedMotion:'reduce'});await context.addCookies([{name:'tenx_local_session',value:token,url:origin,httpOnly:true,sameSite:'Strict'}]);const page=await context.newPage();
for(const section of ['tokens','airdrops','nfts','attention','leaderboards','stake']){
await page.goto(origin+'/'+section);await page.locator('#view[aria-busy=false]').waitFor();
const audit=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,small:[...document.querySelectorAll('button,nav a,summary,input,select')].filter(e=>e.getClientRects().length&&!e.disabled).map(e=>({label:e.textContent.trim().slice(0,45)||e.getAttribute('aria-label')||e.name,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})).filter(e=>e.height<24||e.width<24)}));
if(engine==='webkit')await page.getByRole('link',{name:'Skip to content',exact:true}).focus();else await page.keyboard.press('Tab');await page.keyboard.press('Enter');const skip=await page.evaluate(()=>document.activeElement.id==='main');assert.equal(audit.overflow,false,section+' overflow');assert.equal(skip,true,section+' skip link');results.push({width,height,section,...audit,skip});
await page.screenshot({path:'work/navigation-review/'+section+'-'+width+'.png',fullPage:true});
if(width===1280||width===390)await page.screenshot({path:'work/navigation-review/'+section+'-viewport-'+width+'.png'});
if(section==='nfts'){
assert.equal(await page.locator('.nft-art').count()>0,true);
assert.equal(await page.locator('input[name=material]').count(),0);
assert.equal(await page.getByText('Terms digest',{exact:true}).count(),0);
await page.getByRole('button',{name:'Technical view',exact:true}).click();
assert.equal(await page.getByText('Terms digest',{exact:true}).count()>0,true);
await page.getByRole('button',{name:'Switch to simple view',exact:true}).click();
assert.equal(await page.getByText('Terms digest',{exact:true}).count(),0);
const pairing=page.locator('form[data-upgrade]').first();
const material=await pairing.locator('select option:not([disabled])').first().getAttribute('value');
await pairing.locator('select').selectOption(material);await pairing.getByRole('button',{name:'Preview upgrade',exact:true}).click();
await page.getByRole('dialog').waitFor();await page.getByText('The material survives and may drop to a lower Level, shortening its future benefit period. Its past allocations remain intact.',{exact:true}).waitFor();
await page.getByRole('dialog').getByText('Total cost',{exact:true}).waitFor();await page.keyboard.press('Escape');
const radio=page.getByRole('radio',{name:'As soon as possible',exact:true});await radio.focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('radio',{name:'7 days',exact:true}).isChecked(),true);
const labelSize=await radio.evaluate(e=>e.closest('label').getBoundingClientRect().height);assert(labelSize>=44);

const button=page.getByRole('button',{name:'Preview visual reroll'}).first();await button.focus();await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'Record preview request'}).waitFor();
const dialog=await page.getByRole('dialog').evaluate(d=>({overflow:d.scrollWidth>d.clientWidth,height:d.getBoundingClientRect().height,viewport:innerHeight,buttons:[...d.querySelectorAll('button')].map(e=>({name:e.textContent.trim(),width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))}));
assert.equal(dialog.overflow,false);assert(dialog.height<=dialog.viewport);assert(dialog.buttons.every(b=>b.height>=44&&b.width>=44));
for(let step=0;step<10;step++){await page.keyboard.press('Tab');const focused=await page.evaluate(()=>({inside:document.querySelector('dialog').contains(document.activeElement),hasFocus:document.hasFocus()}));assert(focused.inside||!focused.hasFocus,'Focus escaped modal');}
await page.getByRole('button',{name:'Refresh quote',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Record preview request'}).waitFor();
try{await page.waitForFunction(()=>[...document.querySelectorAll('dialog button')].some(b=>b.textContent==='Record preview request'&&!b.disabled),null,{timeout:7000});}catch(e){console.log(await page.getByRole('dialog').innerText());throw e;}
await page.getByRole('button',{name:'Record preview request',exact:true}).focus();
await page.screenshot({path:'work/navigation-review/reroll-'+width+'.png'});await page.keyboard.press('Escape');const restored=await button.evaluate(b=>b===document.activeElement);assert.equal(restored,true);results.push({width,height,dialog,restored});
}
}await context.close();}
const guest=await browser.newPage({viewport:{width:390,height:844}});for(const section of ['tokens','airdrops','nfts','attention','leaderboards','stake']){await guest.goto(origin+'/'+section);await guest.locator('#view[aria-busy=false]').waitFor();assert.equal(await guest.getByRole('button',{name:'Technical view',exact:true}).count(),1);assert.equal(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
await guest.getByRole('button',{name:'Technical view',exact:true}).click();await guest.reload();await guest.getByRole('button',{name:'Switch to simple view',exact:true}).waitFor();await guest.close();
console.log('Retail checks passed: '+engine+' '+browser.version());writeFileSync('work/navigation-review/retail-audit.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
