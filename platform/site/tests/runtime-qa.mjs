import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { makeCapabilities } from '../../contracts/capabilities.mjs';

// Advertised runtime fixtures drive the real compiled React client. This checks
// client acceptance, not D1/Worker integration (covered by the core profile).
export async function checkRuntimeProfiles({browser,origin}){
  for(const width of [360,390,768,1440]){
    const page=await browser.newPage({viewport:{width,height:900}}),calls=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin)return route.abort();
      if(url.pathname.startsWith('/api/'))calls.push(url.pathname);
      if(url.pathname==='/api/v1/capabilities'){
        // Explicit restricted-profile fixture keeps unavailable-query coverage
        // when the current Worker gains another local read-only capability.
        const cap=makeCapabilities('workerd-local');cap.features=cap.features.filter(f=>!['quote-preview','local-inbox','transaction-receipt-preview'].includes(f.id)&&!f.id.startsWith('collection-'));
        return route.fulfill({json:{data:cap}});
      }
      if(url.pathname==='/api/v1/me')return route.fulfill({json:{data:{wallet:'fixture-worker-wallet',chain:'solana'}}});
      return route.continue();
    });
    try{
      await page.goto(origin+'/collect');
      await page.getByRole('heading',{name:'NFTs',exact:true}).waitFor();
      await page.locator('#view[aria-busy=false]').waitFor();
      await page.getByText('This feature is unavailable in the connected runtime.',{exact:true}).first().waitFor();
      assert.equal(await page.getByText('No published stages',{exact:true}).count(),0);
      assert.equal(await page.getByText('No local collection assets',{exact:true}).count(),0);
      assert.ok(!calls.some(path=>path.startsWith('/api/v1/collect/')),calls.join(','));
      await page.locator('#wallet-button').click();
      await page.getByText('Verified Solana wallet: fixture-worker-wallet',{exact:true}).waitFor();
      assert.equal(await page.getByText('Local inbox settings',{exact:true}).count(),0);
      assert.equal(await page.getByText('Find a transaction receipt',{exact:true}).count(),0);
      assert.ok(!calls.some(path=>/notifications|transactions/.test(path)));
      await page.keyboard.press('Escape');
      if(process.env.SCREENSHOT_DIR){
        await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});
        await page.screenshot({path:join(process.env.SCREENSHOT_DIR,'worker-profile-collect-'+width+'.png')});
      }
      await page.goto(origin+'/markets/browser-att');
      await page.getByRole('heading',{name:'BROWSERATT / BROWSEROG',exact:true}).waitFor();
      await page.locator('#view[aria-busy=false]').waitFor();
      assert.equal(await page.getByRole('button',{name:'Preview swap quote'}).count(),0);
      assert.ok(!calls.some(path=>/quote-status|\/quotes$/.test(path)));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.deepEqual(errors,[]);
    }finally{await page.close();}
    console.log(width+'px Worker-profile unavailable reads/actions and private recovery gating passed.');
  }
  const failed=await browser.newPage(),calls=[];
  await failed.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname.startsWith('/api/'))calls.push(url.pathname);
    return url.pathname==='/api/v1/capabilities'?route.fulfill({status:503,json:{error:{message:'fixture offline'}}}):route.continue();
  });
  try{
    await failed.goto(origin+'/collect');
    await failed.getByText('Runtime capabilities are unavailable. Retry shortly to refresh support.',{exact:true}).first().waitFor();
    await failed.getByRole('heading',{name:'Genesis',exact:true}).waitFor();
    assert.ok(calls.includes('/api/v1/policy'));
    assert.deepEqual([...new Set(calls)].sort(),['/api/v1/capabilities','/api/v1/policy']);
    assert.equal(await failed.getByText('No published stages',{exact:true}).count(),0);
  }finally{await failed.close();}
  console.log('Failed runtime discovery preserves policy and suppresses all dependent requests.');
}
