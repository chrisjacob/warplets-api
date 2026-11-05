import assert from 'node:assert/strict';
import {sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createMemberEvidenceFixture} from '../../application/fixtures/member-evidence.mjs';
import {observeAsset} from '../../vault/ledger.mjs';

async function installWallet(page,fixture){
 const account=fixture.accounts.minimum;
 await page.exposeFunction('signFinancialChallenge',message=>{
  const lines=message.split('\n');assert.equal(lines.length,7);assert.equal(lines[0],fixture.origin+' requests a 10X.MEME wallet signature.');
  assert.equal(lines[1],'Action: Sign in to the local preview');assert.equal(lines[3],'Wallet: '+account.wallet);
  return [...sign(null,Buffer.from(message),account.privateKey)];
 });
 await page.addInitScript(({wallet:address,publicKeyBytes})=>{
  const account={address,publicKey:new Uint8Array(publicKeyBytes),chains:['solana:localnet'],features:['solana:signMessage']};
  const wallet={name:'Synthetic Financial',version:'1.0.0',icon:'data:image/svg+xml,<svg/>',chains:['solana:localnet'],accounts:[account],features:{
   'standard:connect':{version:'1.0.0',connect:async()=>({accounts:[account]})},
   'standard:events':{version:'1.0.0',on:()=>()=>{}},
   'solana:signMessage':{version:'1.0.0',signMessage:async({message})=>[{signature:new Uint8Array(await window.signFinancialChallenge(new TextDecoder().decode(message))),signedMessage:message}]},
  }};
  window.addEventListener('wallet-standard:app-ready',event=>event.detail.register(wallet));
 },{wallet:account.wallet,publicKeyBytes:account.publicKeyBytes});
}

/** Genuine API and message-signature session. All ledger changes are explicit
 * local synthetic fixture observations; this helper never intercepts API data. */
export async function checkFinancialCursors({browser}){
 const evidence=[];
 for(const width of [360,390,768,1440]){
  const fixture=await createMemberEvidenceFixture(),{db,accounts,origin,nowMs}=fixture,page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  const ids=Array.from({length:26},(_,n)=>'synthetic-financial-'+('x'.repeat(90))+'-'+String(n).padStart(3,'0'));
  try{
   for(let n=0;n<26;n++){
    observeAsset(db,{eventId:'move-original-'+n,assetId:'synthetic-minimum-'+String(n).padStart(3,'0'),kind:'transfer',from:accounts.minimum.wallet,to:accounts.bounded.wallet,at:new Date(nowMs-1000).toISOString()},nowMs);
    observeAsset(db,{eventId:'long-bind-'+n,assetId:ids[n],kind:'bind',owner:accounts.minimum.wallet,at:new Date(nowMs-1000).toISOString(),slot:{kind:'genesis',tranche:1,level:1,ordinal:300+n}},nowMs);
   }
   page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await installWallet(page,fixture);
   await page.goto(origin+'/vault');await page.locator('#wallet-button').click();await page.getByRole('button',{name:'Connect Synthetic Financial',exact:true}).click();
   await page.getByRole('button',{name:'Sign in with this message',exact:true}).click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});
   await page.getByText(/Complete local ledger snapshot across 26 owned NFTs/).waitFor();
   const initialResponse=await page.request.get(origin+'/api/v1/vault');assert.equal(initialResponse.headers()['cache-control'],'no-store');const initial=await initialResponse.json();
   assert.equal(initial.summary.assetCount,26);assert.ok(initial.nextCursor.length>256);assert.ok(initial.nextCursor.length<=1024);
   const nextLink=page.getByRole('link',{name:'Next holdings →',exact:true});assert.equal(new URL(await nextLink.getAttribute('href'),origin).searchParams.get('cursor'),initial.nextCursor);
   const nextResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/vault'&&new URL(r.url()).searchParams.has('cursor'));
   await nextLink.focus();await page.keyboard.press('Enter');const nextHttp=await nextResponse;assert.equal(nextHttp.status(),200);
   const next=await nextHttp.json();assert.equal(next.asOf,initial.asOf);assert.equal(next.snapshotId,initial.snapshotId);assert.equal(next.items.length,1);
   await page.getByRole('link',{name:new RegExp(ids[25])}).waitFor();assert.equal(new URL(page.url()).searchParams.get('cursor'),initial.nextCursor);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
   if(!overflow)console.log(JSON.stringify({overflow:await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth).slice(0,8).map(e=>({tag:e.tagName,classes:e.className,right:Math.round(e.getBoundingClientRect().right),text:e.textContent.slice(0,130)})))}));
   assert.equal(overflow,true,'Long financial cursor/ID overflow '+width);
   // Start a fresh document to test the next-page race independently of the
   // previously verified page cache, then transfer one holding after page one.
   await page.goto(origin+'/vault');await page.getByText(/Complete local ledger snapshot across 26 owned NFTs/).waitFor();
   observeAsset(db,{eventId:'after-page-one-transfer',assetId:ids[25],kind:'transfer',from:accounts.minimum.wallet,to:accounts.bounded.wallet,at:new Date(nowMs).toISOString()},nowMs);
   const staleResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/vault'&&new URL(r.url()).searchParams.has('cursor'));
   await page.getByRole('link',{name:'Next holdings →',exact:true}).click();const stale=await staleResponse;assert.equal(stale.status(),409);assert.equal((await stale.json()).error.code,'stale_cursor');
   const restart=page.getByRole('link',{name:'Restart holdings',exact:true});await restart.waitFor();
   assert.equal(await page.getByRole('heading',{name:'Combined local Vault allocations',exact:true}).count(),0);
   const freshResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/vault'&&!new URL(r.url()).searchParams.has('cursor'),{timeout:10000});
   await restart.focus();await page.keyboard.press('Enter');const freshHttp=await freshResponse;assert.equal(freshHttp.status(),200);const fresh=await freshHttp.json();
   assert.equal(fresh.summary.assetCount,25);assert.notEqual(fresh.sourceRevision,initial.sourceRevision);assert.notEqual(fresh.snapshotId,initial.snapshotId);
   await page.getByText(/Complete local ledger snapshot across 25 owned NFTs/).waitFor();assert.equal(new URL(page.url()).searchParams.has('cursor'),false);
   assert.equal(await page.getByRole('link',{name:'Next holdings →',exact:true}).count(),0);assert.deepEqual(errors,[]);
   assert.equal(db.prepare('SELECT COUNT(*) n FROM tx_intents').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM tx_attempts').get().n,0);
   const result={width,cursorLength:initial.nextCursor.length,staleStatus:409,freshAssetCount:25};evidence.push(result);console.log(JSON.stringify({financialCursor:result}));
  }finally{await page.close();await fixture.close();}
 }
 return evidence;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.PLAYWRIGHT_MODULE||!process.env.BROWSER_EXE)throw Error('Set PLAYWRIGHT_MODULE and BROWSER_EXE to installed local dependencies.');
 const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE),browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
 try{await checkFinancialCursors({browser});}finally{await browser.close();}
}
