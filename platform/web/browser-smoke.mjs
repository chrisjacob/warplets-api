// Optional local QA. Point the two environment variables at an already-installed
// Playwright module and Chromium executable. No downloads, credentials or RPC.
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createLocalServer } from '../server/start.mjs';
import { createApp } from '../server/application.mjs';
import { openDatabase } from '../storage/database.mjs';
import { handleWeb } from './handler.mjs';
import { checkMemberPages } from './member-smoke.mjs';

if (!process.env.PLAYWRIGHT_MODULE || !process.env.BROWSER_EXE) {
  throw new Error('Set PLAYWRIGHT_MODULE and BROWSER_EXE to local installations.');
}
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE);
const db = openDatabase(':memory:');
const api = createApp(db);
const server = createLocalServer(async (request,peer) => await handleWeb(request) ?? api(request,peer));
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:'+server.address().port;
let browser;
try {
  browser = await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
  for (const width of [360,390,768,1440]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin
      ? route.continue() : route.abort());
    for (const path of ['/markets','/vault','/stake','/earn','/collect']) {
      await page.goto(origin+path);
      await page.locator('#view[aria-busy=false]').waitFor();
      assert.equal(await page.locator('nav [aria-current=page]').getAttribute('href'),path);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true,
        'Horizontal overflow at '+width+'px '+path);
      if (path==='/markets') {
        await page.locator('#curve-seconds').focus();
        await page.keyboard.press('End');
        assert.equal(await page.locator('#curve-value').textContent(),'1%');
        await page.keyboard.press('Home');
        assert.equal(await page.locator('#curve-value').textContent(),'90%');
        await page.getByRole('button',{name:'Connect wallet'}).click();
        assert.equal(await page.locator('#wallet-dialog').isVisible(),true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#wallet-dialog').isVisible(),false);
        assert.equal(await page.evaluate(()=>document.activeElement.id),'wallet-button');
      }
      if (process.env.SCREENSHOT_DIR && [390,1440].includes(width)) {
        await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:join(process.env.SCREENSHOT_DIR,path.slice(1)+'-'+width+'.png')});
      }
      console.log(width+'px '+path+' passed');
    }
    assert.deepEqual(errors,[]);
    await page.close();
  }
  await checkMemberPages({browser,db,origin});
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  db.close();
}
