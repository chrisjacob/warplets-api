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

if(!process.env.PLAYWRIGHT_MODULE || !process.env.BROWSER_EXE) throw Error('Set PLAYWRIGHT_MODULE and BROWSER_EXE to local installations.');
await stat(new URL('../dist/index.html',import.meta.url));
const db=openDatabase(':memory:'),api=createApp(db);
const server=createLocalServer(async(request,peer)=>await serveSite(request)??api(request,peer));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
let browser;
try {
  browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  for(const width of [360,390,768,1440]){
    const page=await browser.newPage({viewport:{width,height:900}});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    for(const section of ['Markets','Vault','Stake','Earn','Collect']){
      await page.goto(origin+'/'+section.toLowerCase());
      await page.getByRole('heading',{name:section,level:1}).waitFor();
      await page.locator('#view[aria-busy=false]').waitFor();
      assert.equal(await page.locator('nav [aria-current=page]').getAttribute('href'),'/'+section.toLowerCase());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Overflow: '+width+' '+section);
      assert.equal(await page.getByText('This response did not match the expected data format.').count(),0,'API shape: '+section);
      if(section==='Markets'){
        await page.locator('#curve-seconds').focus();await page.keyboard.press('End');
        assert.equal(await page.locator('#curve-value').textContent(),'1%');
        await page.keyboard.press('Home');assert.equal(await page.locator('#curve-value').textContent(),'90%');
        await page.locator('#wallet-button').click();await page.locator('#wallet-dialog').waitFor();
        await page.keyboard.press('Escape');await page.locator('#wallet-dialog').waitFor({state:'hidden'});
        assert.equal(await page.evaluate(()=>document.activeElement.id),'wallet-button');
      }
      if(process.env.SCREENSHOT_DIR && [390,1440].includes(width)){
        await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:join(process.env.SCREENSHOT_DIR,section.toLowerCase()+'-'+width+'.png')});
      }
      console.log(width+'px '+section+' passed');
    }
    // Client-side routing and browser Back must both restore the correct page.
    await page.getByRole('navigation').getByRole('link',{name:'Markets'}).click();
    await page.getByRole('heading',{level:1,name:'Markets'}).waitFor();
    await page.goBack();
    await page.getByRole('heading',{level:1,name:'Collect'}).waitFor();
    assert.deepEqual(errors,[]);await page.close();
  }
  await checkMemberPages({browser,db,origin});
  await checkStandardWallet({browser,db,origin});
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();
}
