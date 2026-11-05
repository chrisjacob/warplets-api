import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {encode58} from '../../server/base58.mjs';
/** Local browser fixture: private session is real; paged asset responses are labelled fixtures.
 * No mutation is sent: the stale quote response deliberately holds confirmation.
 */
export async function checkCollectionDetails({browser,db,origin}){
 const wallet=encode58(randomBytes(32)),token=randomBytes(32).toString('hex');
 db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),wallet,origin,Date.now()+60000);
 const target={id:'fixture-target',inventoryId:'fixture-season',owner:wallet,revealStatus:'revealed',level:2,version:3,
  traits:{model:'Fixture',backdrop:'Fixture',symbol:'Fixture'},expiresAt:'2027-01-01T00:00:00.000Z',rerolls:2,nextRerollAt:null,operationPending:false};
 for(const width of [360,390,768,1440]){
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.addCookies([{name:'tenx_local_session',value:token,url:origin,httpOnly:true,sameSite:'Strict'}]);
  const page=await context.newPage();const calls=[],errors=[];let quotes=0;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(url.pathname==='/api/v1/collect/me/assets'){
    const cursor=url.searchParams.get('cursor');calls.push(cursor);
    const items=cursor?[{...target,id:'fixture-material'}]:[target,...Array.from({length:24},(_,n)=>({...target,id:'fixture-other-'+n,level:3}))];
    return route.fulfill({json:{items,nextCursor:cursor?null:'page-two',source:'local-fixture'}});
   }
   if(url.pathname==='/api/v1/collect/assets/fixture-material')return route.fulfill({json:{data:{...target,id:'fixture-material'}}});
   if(url.pathname==='/api/v1/collect/assets/fixture-target')return route.fulfill({json:{data:target}});
   if(url.pathname.endsWith('/progression/quote')){
    quotes++;return route.fulfill({status:409,json:{error:{code:'stale_asset_version',message:'Fixture ownership changed; refresh the asset pair.'}}});
   }
   return route.continue();
  });
  await page.goto(origin+'/collect');
  const form=page.locator('form[data-upgrade="fixture-target"]');
  await form.getByText('1 matching materials in 26 checked assets. All owned assets checked.').waitFor();
  assert.ok(calls.includes('page-two'),'material choices must traverse the second page');
  const input=form.getByLabel('Same-Level material NFT ID');
  await input.fill('arbitrary-unowned');await input.press('Enter');
  await form.getByText('Choose a listed same-owner, same-Season, same-Level material.').waitFor();assert.equal(quotes,0);
  await input.fill('fixture-material');await input.press('Tab');await page.keyboard.press('Enter');
  await page.getByText('Fixture ownership changed; refresh the asset pair.').waitFor();
  assert.equal(await page.getByRole('button',{name:'Record preview request'}).isDisabled(),true);
  await page.keyboard.press('Escape');await page.locator('#collection-dialog').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.SCREENSHOT_DIR,'collection-populated-'+width+'.png')});}
  assert.deepEqual(errors,[]);await context.close();console.log(width+'px paginated material selection, keyboard review and stale-pair hold passed.');
 }
 db.prepare('DELETE FROM sessions WHERE token_hash=?').run(createHash('sha256').update(token).digest('hex'));
}
