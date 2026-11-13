import assert from 'node:assert/strict';
import {sign} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';

async function installWallet(page,account,origin,onSignature){
 await page.exposeFunction('signHostedChallenge',message=>{
  const lines=message.split('\n');
  assert.equal(lines.length,7);assert.equal(lines[0],origin+' requests a 10X.MEME wallet signature.');
  assert.equal(lines[1],'Action: Sign in to the local preview');assert.equal(lines[2],'Chain: solana');
  assert.equal(lines[3],'Wallet: '+account.wallet);assert.match(lines[4],/^Nonce: [\w-]{43}$/);
  onSignature();return [...sign(null,Buffer.from(message),account.privateKey)];
 });
 await page.addInitScript(({wallet,publicKeyBytes})=>{
  const account={address:wallet,publicKey:new Uint8Array(publicKeyBytes),chains:['solana:localnet'],features:['solana:signMessage']};
  const provider={name:'Synthetic Rehearsal',version:'1.0.0',icon:'data:image/svg+xml,<svg/>',chains:['solana:localnet'],accounts:[account],features:{
   'standard:connect':{version:'1.0.0',connect:async()=>({accounts:[account]})},
   'standard:events':{version:'1.0.0',on:()=>()=>{}},
   'solana:signMessage':{version:'1.0.0',signMessage:async({message})=>{
    if(window.rejectHostedSignature)throw Error('Synthetic wallet declined this signature.');
    return [{signature:new Uint8Array(await window.signHostedChallenge(new TextDecoder().decode(message))),signedMessage:message}];
   }},
  }};
  window.addEventListener('wallet-standard:app-ready',event=>event.detail.register(provider));
 },{wallet:account.wallet,publicKeyBytes:account.publicKeyBytes});
}

/** Real browser/API acceptance. Only the final failed-discovery case intercepts
 * a response; it is reported separately as an explicitly injected UI fault. */
export async function checkHostedRuntime({browser,runtime,fixture}){
 const {origin,db}=runtime,account=fixture.browserAccount??fixture.accounts[0],widths=[360,390,768,1440];
 const contentUrl=fixture.browserContentUrl??'https://example.test/synthetic-hosted-browser-contribution';
 let signatures=0,admissionId;
 assert.equal((await fetch(origin+'/__fixture',{method:'POST',body:'{}'})).status,404);
 const wrongHost=await new Promise((resolve,reject)=>{
  const request=httpRequest(origin+'/api/v1/health',{headers:{host:'untrusted.example'}},response=>{response.resume();resolve(response.statusCode);});
  request.on('error',reject);request.end();
 });assert.equal(wrongHost,403);
 const wrongOrigin=await fetch(origin+'/api/v1/auth/challenges',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:JSON.stringify({wallet:account.wallet})});
 assert.equal(wrongOrigin.status,403);assert.equal((await wrongOrigin.json()).error.code,'invalid_origin');
 for(const width of widths){
  const page=await browser.newPage({viewport:{width,height:900}}),calls=[],errors=[];let releaseCapacity;
  const capacityWait=new Promise(resolve=>{releaseCapacity=resolve;});let delayed=false;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
   if(url.pathname.startsWith('/api/'))calls.push(url.pathname);
   if(width===360&&!delayed&&url.pathname==='/api/v1/earn/capacity'){delayed=true;await capacityWait;}
   return route.continue();
  });
  await installWallet(page,account,origin,()=>{signatures++;});
  try{
   await page.goto(origin+'/earn');await page.getByRole('heading',{name:'Earn',exact:true}).waitFor();
   if(width===360){await page.locator('#view[aria-busy=true]').waitFor();releaseCapacity();}
   await page.locator('#view[aria-busy=false]').waitFor();
   const capability=await page.evaluate(async()=>{const response=await fetch('/api/v1/capabilities');const value=await response.json();return value.data??value;});
   assert.equal(capability.runtime,'workerd-local');assert.equal(capability.walletAuthentication,'message-only');
   assert.ok(Object.values(capability.production).every(value=>value===false));
   await page.locator('#wallet-button').click();await page.locator('#wallet-dialog').waitFor();
   await page.keyboard.press('Escape');await page.locator('#wallet-dialog').waitFor({state:'hidden'});
   assert.equal(await page.evaluate(()=>document.activeElement.id),'wallet-button');
   await page.locator('#wallet-button').click();await page.getByRole('button',{name:'Connect Synthetic Rehearsal'}).click();await page.getByRole('button',{name:/^Use account /}).click();
   const signButton=page.getByRole('button',{name:'Sign in with this message'});await signButton.waitFor();
   if(width===360){
    await page.evaluate(()=>{window.rejectHostedSignature=true;});await signButton.click();
    await page.getByText('Synthetic wallet declined this signature.',{exact:true}).waitFor();
    assert.equal(signatures,0);await page.evaluate(()=>{window.rejectHostedSignature=false;});
   }
   await signButton.click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});
   await page.locator('#submission-form').waitFor();
   const session=await db.prepare('SELECT COUNT(*) n FROM sessions WHERE wallet=? AND origin=?').bind(account.wallet,origin).first('n');assert.equal(session,1);
   if(width===360){
    await page.getByLabel('ATT campaign').selectOption(fixture.browserTokenId);
    await page.getByLabel('Content URL').fill(contentUrl);
    const accepted=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v1/earn/submissions'&&response.request().method()==='POST');
    await page.getByRole('button',{name:'Submit contribution',exact:true}).click();
    const response=await accepted;assert.equal(response.status(),201);const body=await response.json();admissionId=(body.data??body).id;
    await page.getByText('Contribution recorded for moderation.',{exact:true}).waitFor();
   }
   await page.getByText(contentUrl,{exact:true}).waitFor();
   const admitted=await db.prepare('SELECT id,wallet FROM earn_submissions WHERE id=?').bind(admissionId).first();assert.equal(admitted.wallet,account.wallet);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Earn overflow '+width);
   if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.SCREENSHOT_DIR,'hosted-earn-'+width+'.png')});}
   await page.getByRole('navigation').getByRole('link',{name:'NFTs',exact:true}).click();
   await page.getByRole('heading',{name:'NFTs',exact:true}).waitFor();await page.locator('#view[aria-busy=false]').waitFor();
   await page.getByText('This feature is unavailable in the connected runtime.',{exact:true}).first().waitFor();
   assert.equal(await page.getByText('No published stages',{exact:true}).count(),0);
   assert.ok(!calls.some(path=>path.startsWith('/api/v1/collect/')),calls.join(','));
   await page.goto(origin+'/markets/'+encodeURIComponent(fixture.browserTokenId));await page.locator('#view[aria-busy=false]').waitFor();
   assert.equal(await page.getByRole('button',{name:'Preview swap quote'}).count(),0);
   await page.getByRole('button',{name:'Check quote availability'}).waitFor();
   assert.ok(calls.some(path=>path.endsWith('/quote-status')),'Advertised quote read must mount and return unavailable without source evidence.');
   assert.ok(!calls.some(path=>/\/quotes$|\/notifications\/|\/transactions\//.test(path)),calls.join(','));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Market overflow '+width);
   await page.goto(origin+'/earn');await page.getByText(contentUrl,{exact:true}).waitFor();
   await page.locator('#wallet-button').click();await page.getByRole('button',{name:'Sign out',exact:true}).click();
   await page.locator('#wallet-dialog').waitFor({state:'hidden'});await page.locator('#view').getByRole('button',{name:'Connect wallet',exact:true}).waitFor();
   assert.equal(await page.getByText(contentUrl,{exact:true}).count(),0);
   assert.equal(await db.prepare('SELECT COUNT(*) n FROM sessions WHERE wallet=? AND origin=?').bind(account.wallet,origin).first('n'),0);
   assert.deepEqual(errors,[]);console.log(width+'px real workerd authentication, Earn admission/history, capability gating and logout passed.');
  }finally{releaseCapacity();await page.close();}
 }
 const failed=await browser.newPage(),calls=[];
 await failed.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
  if(url.pathname.startsWith('/api/'))calls.push(url.pathname);
  return url.pathname==='/api/v1/capabilities'?route.fulfill({status:503,json:{error:{code:'synthetic_discovery_fault',message:'Synthetic discovery unavailable.'}}}):route.continue();
 });
 try{
  await failed.goto(origin+'/collect');await failed.getByText('Runtime capabilities are unavailable. Retry shortly to refresh support.',{exact:true}).first().waitFor();
  assert.deepEqual([...new Set(calls)].sort(),['/api/v1/capabilities','/api/v1/policy']);
 }finally{await failed.close();}
 return {widths,signatures,admissionId,wallet:account.wallet,runtime:'workerd-local',financialExecution:false,
  injectedUiFaults:['declined-wallet-signature','delayed-capacity-response','unavailable-capability-discovery']};
}
