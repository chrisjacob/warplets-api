import assert from 'node:assert/strict';
import {sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createCollectionEdgeFixture} from '../../application/fixtures/collection-edges.mjs';
import {observeCollectionAsset} from '../../collect/store.mjs';
export async function checkCollectionEdges({browser}){
 for(const width of [360,390,768,1440]){
  const f=await createCollectionEdgeFixture(),page=await browser.newPage({viewport:{width,height:900}}),errors=[];let quotes=0,vaultReads=0;
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{
   const url=new URL(route.request().url());if(url.origin!==f.origin)return route.abort();if(url.pathname.endsWith('/progression/quote'))quotes++;if(/^\/api\/v1\/nfts\/[^/]+\/vault$/.test(url.pathname))vaultReads++;return route.continue();
  });
  await page.exposeFunction('signCollectionEdge',message=>{
   assert.ok(message.startsWith(f.origin+' requests a 10X.MEME wallet signature.\nAction: Sign in to the local preview\nChain: solana\nWallet: '+f.accounts.original.wallet+'\n'));
   return [...sign(null,Buffer.from(message),f.accounts.original.privateKey)];
  });
  await page.addInitScript(wallet=>{window.solana={publicKey:wallet,connect:async()=>({publicKey:wallet}),signMessage:async message=>({signature:new Uint8Array(await window.signCollectionEdge(new TextDecoder().decode(message)))})};},f.accounts.original.wallet);
  try{
   await page.goto(f.origin+'/collect');await page.locator('#wallet-button').click();await page.getByRole('button',{name:'Connect Solana wallet',exact:true}).click();
   await page.getByRole('button',{name:'Sign in with this message',exact:true}).click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});
   const stage=page.locator('.stage').filter({has:page.getByRole('heading',{name:'synthetic-free',exact:true})});
   await stage.getByText('unknown',{exact:true}).waitFor();await stage.getByText('opening-snapshot-pending',{exact:true}).waitFor();assert.equal(await stage.getByRole('button',{name:'Review reservation'}).count(),0);
   await stage.getByText('Complete opening-cut evidence is pending',{exact:true}).waitFor();await stage.getByText('Availability is unknown',{exact:true}).waitFor();
   f.acceptSnapshot();await page.reload();await stage.getByText('eligible',{exact:true}).waitFor();
   await stage.getByText('Eligible for a local reservation',{exact:true}).waitFor();
   const acceptedCut=f.db.prepare('SELECT snapshot_hash FROM collect_snapshots WHERE inventory_id=? AND stage_id=?').get(f.seasonId,'synthetic-free').snapshot_hash;
   assert.equal(await stage.locator('dt').filter({hasText:/^Accepted opening-cut digest$/}).locator('..').locator('dd').textContent(),acceptedCut);
   const cut=new Date(f.cut).toISOString().slice(0,16).replace('T',' ')+' UTC';assert.ok((await stage.textContent()).includes(cut));
   await stage.getByRole('button',{name:'Review reservation',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Review mint reservation',exact:true}).waitFor();
   await page.locator('#collection-dialog').getByText('0 SOL',{exact:true}).waitFor();await page.keyboard.press('Escape');await page.locator('#collection-dialog').waitFor({state:'hidden'});
   const form=page.locator('form[data-upgrade="synthetic-season-000"]'),input=form.getByLabel('Same-Level material NFT ID');
   await form.getByText('99 matching materials in 100 checked assets. Selection is limited to the first 100 owned assets.',{exact:true}).waitFor();
   await input.fill('synthetic-season-100');await input.press('Enter');await form.getByText('Choose a listed same-owner, same-Season, same-Level material.',{exact:true}).waitFor();assert.equal(quotes,0);
   await input.fill('synthetic-season-001');await input.press('Tab');await page.keyboard.press('Enter');
   await page.getByRole('heading',{name:'Review Level upgrade',exact:true}).waitFor();await page.getByText('Material Level probabilities',{exact:true}).click();
   await page.getByText('The material survives and may drop to a lower Level, shortening its future benefit period. Its past allocations remain intact.',{exact:true}).waitFor();
   for(const [label,id,claimed] of [['Target','synthetic-season-000','1'],['Material','synthetic-season-001','0']]){
    const context=page.getByRole('region',{name:label+' before progression',exact:true});
    await context.getByText('All recorded allocation rows returned.',{exact:false}).waitFor();
    const asset=await (await page.request.get(f.origin+'/api/v1/collect/assets/'+id)).json(),vault=await (await page.request.get(f.origin+'/api/v1/nfts/'+id+'/vault')).json();
    for(const [key,value] of [['NFT',id],['Current Level',String(asset.level)],['Asset version',String(asset.version)],['Completed visual rerolls',String(asset.rerolls)]])
     assert.equal(await context.locator('dt').filter({hasText:new RegExp('^'+key+'$')}).locator('..').locator('dd').textContent(),value);
    assert.equal(vault.items.length,1);assert.equal(vault.items[0].claimed,claimed);
    for(const [key,value] of [['Allocated base units',vault.items[0].allocated],['Claimed base units',vault.items[0].claimed],['Available base units',vault.items[0].claimable],['Manifest digest',vault.items[0].manifestDigest]])
     assert.equal(await context.locator('dt').filter({hasText:new RegExp('^'+key+'$')}).locator('..').locator('dd').textContent(),value);
    await context.getByText('Amounts stay separate by NFT and token. Fiat pricing is unavailable. Progression preserves these historical allocations and claimed amounts.',{exact:true}).waitFor();
   }
   assert.equal(await page.locator('#collection-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
   if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.getByRole('heading',{name:'Target before progression',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.SCREENSHOT_DIR,'collection-pair-review-'+width+'.png')});}
   const quoteResponse=await page.request.post(f.origin+'/api/v1/collect/inventories/'+f.seasonId+'/progression/quote',{headers:{origin:f.origin,'idempotency-key':'synthetic-qa-quote-'+width},data:{kind:'upgrade',targetId:'synthetic-season-000',materialId:'synthetic-season-001',expectedTargetVersion:0,expectedMaterialVersion:0}});
   const quote=await quoteResponse.json();assert.equal(quoteResponse.status(),200);assert.equal(quote.nextTargetLevel,2);assert.ok(Date.parse(quote.nextTargetExpiry)>f.nowMs);assert.equal(quote.materialProbabilities[0].remainingMs,0);
   const historical=f.historical(),before=await (await page.request.get(f.origin+'/api/v1/nfts/synthetic-season-000/vault')).json();
   await page.getByRole('button',{name:'Record preview request',exact:true}).click();await page.locator('#collection-dialog').waitFor({state:'hidden'});await page.getByText('Awaiting committed draw evidence.',{exact:true}).first().waitFor();
   const operation=f.db.prepare("SELECT id FROM collect_operations WHERE kind='upgrade' AND owner=?").get(f.accounts.original.wallet);assert.ok(operation);
   await f.fulfill(operation.id);await page.reload();const target=page.locator('article.record').filter({has:page.getByRole('heading',{name:'synthetic-season-000',exact:true})});
   await target.locator('dt').filter({hasText:/^Level$/}).locator('..').getByText('2',{exact:true}).waitFor();
   assert.equal(f.historical(),historical);
   const after=await (await page.request.get(f.origin+'/api/v1/nfts/synthetic-season-000/vault')).json();
   const {sourceRevision:beforeRevision,snapshotId:beforeSnapshot,...beforeAccounting}=before;
   const {sourceRevision:afterRevision,snapshotId:afterSnapshot,...afterAccounting}=after;
   assert.ok(BigInt(afterRevision)>BigInt(beforeRevision));assert.notEqual(afterSnapshot,beforeSnapshot);
   assert.deepEqual(afterAccounting,beforeAccounting);
   assert.equal(await target.getByText('Awaiting committed draw evidence.',{exact:true}).count(),0);await target.getByText('Historical allocations retain their original vesting clock after expiry, transfer or progression.',{exact:true}).waitFor();
   await target.getByRole('link',{name:'Vault allocations ↗',exact:true}).click();await page.getByRole('heading',{name:'Allocations for synthetic-season-000',exact:true}).waitFor();
   await page.getByText('Original allocation vesting clocks',{exact:true}).click();await page.goBack();await target.getByRole('link',{name:'Vault allocations ↗',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
   if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await target.scrollIntoViewIfNeeded();await page.screenshot({path:join(process.env.SCREENSHOT_DIR,'collection-edges-'+width+'.png')});}
   const staleForm=page.locator('form[data-upgrade="synthetic-season-002"]');await staleForm.getByLabel('Same-Level material NFT ID').waitFor();
   observeCollectionAsset(f.db,{sourceId:'synthetic-review-transfer',assetId:'synthetic-season-002',kind:'transfer',from:f.accounts.original.wallet,to:f.accounts.buyer.wallet,at:f.nowMs,finalized:true},f.nowMs);
   const counts={quotes,vaultReads};await staleForm.getByLabel('Same-Level material NFT ID').fill('synthetic-season-003');await staleForm.getByLabel('Same-Level material NFT ID').press('Enter');
   await page.getByText('The target ownership, reveal or version changed. Refresh the selected asset.',{exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Record preview request',exact:true}).isDisabled(),true);assert.deepEqual({quotes,vaultReads},counts,'stale target must not issue a quote or private historical reads');
   await page.keyboard.press('Escape');await page.locator('#collection-dialog').waitFor({state:'hidden'});
   await page.locator('#wallet-button').click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});
   assert.equal(await page.getByRole('heading',{name:'Your collection',exact:true}).count(),0);
   console.log(width+'px real-API fixed-cut eligibility, 100-asset bound, expired pair reactivation and historical Vault continuity passed.');
  }finally{await page.close();await f.close();}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.PLAYWRIGHT_MODULE||!process.env.BROWSER_EXE)throw Error('Set PLAYWRIGHT_MODULE and BROWSER_EXE to installed local dependencies.');
 const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE),browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
 try{await checkCollectionEdges({browser});}finally{await browser.close();}
}
