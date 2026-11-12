import assert from 'node:assert/strict';
import {sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createMintReviewFixture} from '../../application/fixtures/mint-review.mjs';
export async function checkMintLifecycle({browser,widths=[360,390,768,1440],wrongResponse=false,expireBeforeConfirm=false,serverRejectBeforeConfirm=false}){
 for(const width of widths){
  const f=await createMintReviewFixture(),page=await browser.newPage({viewport:{width,height:1000}}),errors=[],requests=[];let inject=true;
  page.on('pageerror',error=>errors.push(error.message));await page.clock.setFixedTime(f.now());
  await page.exposeFunction('signMintChallenge',message=>{const account=Object.values(f.accounts).find(a=>message.includes('\nWallet: '+a.wallet+'\n'));assert.ok(account);assert.ok(message.startsWith(f.origin+' requests a 10X.MEME wallet signature.\nAction: Sign in to the local preview\n'));return [...sign(null,Buffer.from(message),account.privateKey)];});
  await page.addInitScript(wallet=>{window.fixtureMintWallet=wallet;window.solana={get publicKey(){return window.fixtureMintWallet;},connect:async()=>({publicKey:window.fixtureMintWallet}),signMessage:async message=>({signature:new Uint8Array(await window.signMintChallenge(new TextDecoder().decode(message)))})};},f.accounts.original.wallet);
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==f.origin)return route.abort();
   if(request.method()==='POST'&&url.pathname.endsWith('/reservations')){
    requests.push({path:url.pathname,key:request.headers()['idempotency-key'],body:request.postDataJSON()});
    if(inject&&!serverRejectBeforeConfirm){inject=false;const response=await route.fetch();assert.equal(response.status(),201);
     // Negative-only transport fault: the genuine service has already committed.
     if(wrongResponse){const payload=await response.json();payload.data.operation.termsDigest='f'.repeat(64);return route.fulfill({response,json:payload});}
     return route.abort('failed');
    }
   }
   return route.continue();
  });
  async function signIn(account=f.accounts.original){await page.evaluate(wallet=>{window.fixtureMintWallet=wallet;},account.wallet);await page.locator('#wallet-button').click();await page.getByRole('button',{name:'Connect Solana wallet',exact:true}).click();await page.getByRole('button',{name:/^Use account /}).click();await page.getByRole('button',{name:'Sign in with this message',exact:true}).click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});}
  async function signOut(){await page.locator('#wallet-button').click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});}
  const dialog=page.locator('#collection-dialog'),count=()=>f.db.prepare('SELECT COUNT(*) n FROM app_collection_mint_admissions').get().n;
  try{
   await page.goto(f.origin+'/collect');await signIn();await page.getByRole('button',{name:'Review reservation',exact:true}).click();await page.getByRole('heading',{name:'Review mint reservation',exact:true}).waitFor();
   await dialog.getByText('Local creation cost',{exact:true}).waitFor();assert.equal(await dialog.getByText('Unknown',{exact:true}).count(),2);assert.equal(await dialog.getByText('Creation and network quote',{exact:true}).count(),0);
   await dialog.getByText('These are the disclosed local components. Network and total costs are unknown. No SOL is sent by this preview.',{exact:true}).waitFor();
   assert.equal(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth),true);
   if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.SCREENSHOT_DIR,'mint-reviewed-terms-'+width+(wrongResponse?'-wrong-response':expireBeforeConfirm?'-expiry':'')+'.png')});}
   if(expireBeforeConfirm){
    f.advanceTo(f.input.closesAt+1);await page.clock.setFixedTime(f.now());await dialog.getByText('The stage is no longer available for a new reservation. Close this review and refresh the published stage.',{exact:true}).waitFor();assert.equal(await dialog.getByRole('button',{name:'Reserve preview slot',exact:true}).isDisabled(),true);assert.equal(count(),0);assert.equal(requests.length,0);
   }else if(serverRejectBeforeConfirm){
    // The browser still displays its original review; only the private server
    // clock advances. The actual API must reject it without creating a receipt.
    f.advanceTo(f.input.closesAt+1);await dialog.getByRole('button',{name:'Reserve preview slot',exact:true}).click();await dialog.getByText('The stage is no longer available for a new reservation. Close this review and refresh the published stage.',{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Reserve preview slot',exact:true}).isDisabled(),true);assert.equal(count(),0);assert.equal(requests.length,1);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('10x.mint.pending.v1:')).length),0);
   }else{
    await dialog.getByRole('button',{name:'Reserve preview slot',exact:true}).click();await dialog.getByRole('button',{name:'Retry original request',exact:true}).waitFor();await dialog.getByText('The result of this original mint request is unresolved. Retry its retained key and reviewed terms to recover the result.',{exact:true}).waitFor();
    if(wrongResponse)await dialog.getByText('The response did not match the retained mint request. Retry the original request.',{exact:true}).waitFor();
    assert.equal(count(),1);const original=requests[0];assert.deepEqual(original.body,{expectedTermsDigest:f.published.value.termsDigest});assert.ok(original.key);
    const accepted=f.db.prepare('SELECT result_json FROM app_command_receipts WHERE operation_kind=?').get('collection.reserve-operation.v1');
    await page.reload();await page.getByRole('heading',{name:'Mint requests awaiting a result',exact:true}).waitFor();await signOut();assert.equal(await page.getByRole('heading',{name:'Mint requests awaiting a result',exact:true}).count(),0);
    f.advanceTo(f.input.closesAt+1);await page.clock.setFixedTime(f.now());
    await signIn(f.accounts.other);assert.equal(await page.getByRole('heading',{name:'Mint requests awaiting a result',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Review original mint request',exact:true}).count(),0);await signOut();await signIn();
    f.db.prepare("INSERT INTO ops_scope_log VALUES('synthetic-browser-mint-pause','collection-mint',1,NULL,?,'synthetic-operator','fixture pause','synthetic-evidence','synthetic-browser-mint-pause')").run(f.now());
    await page.getByRole('button',{name:'Review original mint request',exact:true}).click();await dialog.getByText('The original stage has closed. An identical retry can still recover an already accepted reservation.',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Retry original request',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(requests.length,2);assert.deepEqual(requests[1],original);assert.equal(count(),1);assert.deepEqual(f.db.prepare('SELECT result_json FROM app_command_receipts WHERE operation_kind=?').get('collection.reserve-operation.v1'),accepted);
    await page.getByRole('heading',{name:'Operation receipt',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Mint requests awaiting a result',exact:true}).count(),0);assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('10x.mint.pending.v1:')).length),0);
   }
   assert.equal(f.db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
   console.log(JSON.stringify({width,classification:'synthetic normalized stage and private clock; production Node HTTP/repositories; genuine Ed25519 auth; negative-only response fault injection',reviewedDigest:true,networkCost:'unknown',totalCost:'unknown',financialExecution:false,...(expireBeforeConfirm?{expiredFreshConfirmationBlocked:true}:serverRejectBeforeConfirm?{serverClosedBeforeConfirmationRejected:true,knownRejectionCleared:true}:{unknownRetryAfterCloseAndPauseExactBodyAndKey:true,reloadRecovery:true,ownerSessionIsolation:true,...(wrongResponse?{negativeCorruptedResponseRetained:true}:{lostCommittedResponseRecovered:true})}),admissions:count()}));
  }finally{await page.close();await f.close();}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.PLAYWRIGHT_MODULE||!process.env.BROWSER_EXE)throw Error('Set PLAYWRIGHT_MODULE and BROWSER_EXE to installed local dependencies.');
 const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE),browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
 try{await checkMintLifecycle({browser,...(process.argv.includes('--wrong-response')?{widths:[390],wrongResponse:true}:process.argv.includes('--expiry')?{widths:[390],expireBeforeConfirm:true}:process.argv.includes('--server-reject')?{widths:[390],serverRejectBeforeConfirm:true}:{})});}finally{await browser.close();}
}
