import assert from 'node:assert/strict';
import {sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createProgressionReviewFixture} from '../../application/fixtures/progression-review.mjs';
import {observeCollectionAsset} from '../../collect/store.mjs';
export async function checkProgressionLifecycle({browser,widths=[360,390,768,1440],wrongResponse=false}){
 for(const width of widths){
  const f=await createProgressionReviewFixture(),page=await browser.newPage({viewport:{width,height:1000}}),errors=[],quotes=[],reservations=[];let dropQuote=true,dropReservation=true,corruptReservation=false;
  page.on('pageerror',error=>errors.push(error.message));await page.clock.setFixedTime(f.now());
  await page.exposeFunction('signProgressionChallenge',message=>{const account=Object.values(f.accounts).find(account=>message.includes('\nWallet: '+account.wallet+'\n'));assert.ok(account);assert.ok(message.startsWith(f.origin+' requests a 10X.MEME wallet signature.\nAction: Sign in to the local preview\n'));return [...sign(null,Buffer.from(message),account.privateKey)];});
  await page.addInitScript(wallet=>{window.fixtureProgressionWallet=wallet;window.solana={get publicKey(){return window.fixtureProgressionWallet;},connect:async()=>({publicKey:window.fixtureProgressionWallet}),signMessage:async message=>({signature:new Uint8Array(await window.signProgressionChallenge(new TextDecoder().decode(message)))})};},f.accounts.original.wallet);
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==f.origin)return route.abort();
   if(request.method()==='POST'&&url.pathname.endsWith('/progression/quote')){
    quotes.push({key:request.headers()['idempotency-key'],body:request.postDataJSON()});
    if(dropQuote){dropQuote=false;const response=await route.fetch();assert.equal(response.status(),200);return route.abort('failed');}
   }else if(request.method()==='POST'&&url.pathname.endsWith('/progression')){
    reservations.push({key:request.headers()['idempotency-key'],body:request.postDataJSON()});
    if(dropReservation){dropReservation=false;const response=await route.fetch();assert.equal(response.status(),201);return route.abort('failed');}
    if(corruptReservation){corruptReservation=false;const response=await route.fetch();assert.equal(response.status(),201);const payload=await response.json();payload.data.operation.bindingDigest='f'.repeat(64);return route.fulfill({response,json:payload});}
   }
   return route.continue();
  });
  async function signIn(account=f.accounts.original){await page.evaluate(wallet=>{window.fixtureProgressionWallet=wallet;},account.wallet);await page.locator('#wallet-button').click();await page.getByRole('button',{name:'Connect Solana wallet',exact:true}).click();await page.getByRole('button',{name:/^Use account /}).click();await page.getByRole('button',{name:'Sign in with this message',exact:true}).click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});}
  async function signOut(){await page.locator('#wallet-button').click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});}
  async function pair(target='synthetic-season-000',material='synthetic-season-001'){const form=page.locator('form[data-upgrade="'+target+'"]');await form.getByLabel('Same-Level material NFT ID').fill(material);await form.getByLabel('Same-Level material NFT ID').press('Enter');await page.getByRole('heading',{name:'Review Level upgrade',exact:true}).waitFor();}
  const dialog=page.locator('#collection-dialog'),count=()=>f.db.prepare("SELECT COUNT(*) n FROM collect_operations WHERE kind='upgrade'").get().n;
  try{
   await page.goto(f.origin+'/collect');await signIn();await pair();await dialog.getByRole('button',{name:'Retry',exact:true}).click();await dialog.getByText('Reviewed local-component ceiling',{exact:true}).waitFor();assert.equal(quotes.length,2);assert.deepEqual(quotes[1],quotes[0]);
   assert.equal(f.db.prepare('SELECT COUNT(*) n FROM app_collection_quotes').get().n,1);assert.equal(await dialog.getByText('Unknown',{exact:true}).count(),2);
   await dialog.getByText('The ceiling covers the disclosed local components only. Network and total costs are unknown. No SOL is sent by this preview.',{exact:true}).waitFor();
   const old=f.db.prepare('SELECT * FROM app_collection_quotes').get(),oldBytes=old.body_json;f.advanceTo(old.expires_ms+1);await page.clock.setFixedTime(f.now());
   await dialog.getByText('This quote has expired. Refresh it and review the new terms before confirming.',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Record preview request',exact:true}).isDisabled(),true);assert.equal(reservations.length,0);
   await dialog.getByRole('button',{name:'Refresh quote',exact:true}).click();await dialog.getByRole('button',{name:'Record preview request',exact:true}).waitFor();await page.waitForFunction(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Record preview request');return button&&!button.disabled;});assert.equal(quotes.length,3);assert.notEqual(quotes[2].key,quotes[0].key);assert.equal(f.db.prepare('SELECT body_json FROM app_collection_quotes WHERE id=?').get(old.id).body_json,oldBytes);
   assert.equal(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth),true);if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.SCREENSHOT_DIR,'progression-reviewed-terms-'+width+'.png')});}
   await dialog.getByRole('button',{name:'Record preview request',exact:true}).click();await dialog.getByRole('button',{name:'Retry original request',exact:true}).waitFor();await dialog.getByText('The result of this original reviewed request is unresolved. Retry its retained key and terms to recover the result.',{exact:true}).waitFor();assert.equal(count(),1);
   const accepted=reservations[0],quoteCount=quotes.length;assert.ok(accepted.body.quoteId&&accepted.body.bindingDigest&&accepted.body.policyVersion);assert.equal(accepted.body.reviewedFeeLamports,accepted.body.reviewedMaxTotalLamports);assert.equal(accepted.body.quoteExpiresMs,f.db.prepare('SELECT expires_ms FROM app_collection_quotes WHERE id=?').get(accepted.body.quoteId).expires_ms);
   f.advanceTo(accepted.body.quoteExpiresMs+1);await page.clock.setFixedTime(f.now());await dialog.getByText('The original quote has expired. An identical retry can still recover an already accepted request.',{exact:true}).waitFor();
   await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await page.getByRole('heading',{name:'Requests awaiting a result',exact:true}).waitFor();await signOut();assert.equal(await page.getByRole('heading',{name:'Requests awaiting a result',exact:true}).count(),0);
   await signIn(f.accounts.buyer);assert.equal(await page.getByRole('heading',{name:'Requests awaiting a result',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Review original request',exact:true}).count(),0);await signOut();await signIn();
   await page.getByRole('button',{name:'Review original request',exact:true}).click();await dialog.getByRole('button',{name:'Retry original request',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(reservations.length,2);assert.deepEqual(reservations[1],accepted);assert.equal(count(),1);assert.equal(quotes.length,quoteCount);assert.equal(await page.getByRole('heading',{name:'Requests awaiting a result',exact:true}).count(),0);
   await pair('synthetic-season-002','synthetic-season-003');await dialog.getByText('Reviewed local-component ceiling',{exact:true}).waitFor();observeCollectionAsset(f.db,{sourceId:'synthetic-lifecycle-transfer',assetId:'synthetic-season-002',kind:'transfer',from:f.accounts.original.wallet,to:f.accounts.buyer.wallet,at:Math.floor(f.now()/1000)*1000,finalized:true},f.now());
   await dialog.getByRole('button',{name:'Record preview request',exact:true}).click();await dialog.getByText('The request was not accepted. Refresh the quote and review current ownership and terms.',{exact:true}).waitFor();assert.equal(count(),1);assert.equal(await dialog.getByRole('button',{name:'Record preview request',exact:true}).isDisabled(),true);
   const beforeRefresh=quotes.length;await dialog.getByRole('button',{name:'Refresh quote',exact:true}).click();await dialog.getByText('The target ownership, reveal or version changed. Refresh the selected asset.',{exact:true}).waitFor();assert.equal(quotes.length,beforeRefresh);await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
   if(wrongResponse){
    // Negative-only fault injection: the real API commits the operation, then
    // only the returned binding is corrupted. The positive retry is untouched.
    await pair('synthetic-season-004','synthetic-season-005');await dialog.getByText('Reviewed local-component ceiling',{exact:true}).waitFor();corruptReservation=true;
    await dialog.getByRole('button',{name:'Record preview request',exact:true}).click();await dialog.getByText('The response did not match the retained request. Retry the original request.',{exact:true}).waitFor();assert.equal(count(),2);const original=reservations.at(-1);
    assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('10x.progression.pending.v1:')).length),1);
    await dialog.getByRole('button',{name:'Retry original request',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.deepEqual(reservations.at(-1),original);assert.equal(count(),2);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('10x.progression.pending.v1:')).length),0);
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
   console.log(JSON.stringify({width,classification:'synthetic private clock; actual HTTP/repositories; genuine Ed25519 auth; response-loss fault injection',quoteRetriesSameKey:true,expiredFreshConfirmationBlocked:true,explicitRefreshNewQuote:true,unknownRetryAfterExpiryExactBodyAndKey:true,ownerSessionIsolation:true,staleOwnerRejected:true,...(wrongResponse?{negativeCorruptedResponseRetained:true}:{}),reservations:count(),networkCost:'unknown',totalCost:'unknown',financialExecution:false}));
  }finally{await page.close();await f.close();}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.PLAYWRIGHT_MODULE||!process.env.BROWSER_EXE)throw Error('Set PLAYWRIGHT_MODULE and BROWSER_EXE to installed local dependencies.');
 const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE),browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});try{await checkProgressionLifecycle({browser,...(process.argv.includes('--wrong-response')?{widths:[390],wrongResponse:true}:{})});}finally{await browser.close();}
}
