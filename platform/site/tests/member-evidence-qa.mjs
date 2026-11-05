import assert from 'node:assert/strict';
import {sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createMemberEvidenceFixture} from '../../application/fixtures/member-evidence.mjs';

async function installWallet(page,fixture){
 await page.exposeFunction('signMemberEvidence',message=>{
  const lines=message.split('\n'),account=Object.values(fixture.accounts).find(a=>lines[3]==='Wallet: '+a.wallet);
  assert.ok(account);assert.equal(lines.length,7);assert.equal(lines[0],fixture.origin+' requests a 10X.MEME wallet signature.');
  assert.equal(lines[1],'Action: Sign in to the local preview');return [...sign(null,Buffer.from(message),account.privateKey)];
 });
 await page.addInitScript(accounts=>{
  const options=Object.fromEntries(accounts.map(a=>[a.label,{address:a.wallet,publicKey:new Uint8Array(a.publicKeyBytes),chains:['solana:localnet'],features:['solana:signMessage']}]));
  const listeners=new Set(),wallet={name:'Synthetic Member',version:'1.0.0',icon:'data:image/svg+xml,<svg/>',chains:['solana:localnet'],accounts:[options.minimum],features:{
   'standard:connect':{version:'1.0.0',connect:async()=>({accounts:wallet.accounts})},
   'standard:events':{version:'1.0.0',on:(_event,listener)=>{listeners.add(listener);return()=>listeners.delete(listener);}},
   'solana:signMessage':{version:'1.0.0',signMessage:async({message})=>[{signature:new Uint8Array(await window.signMemberEvidence(new TextDecoder().decode(message))),signedMessage:message}]},
  }};
  window.chooseMemberAccount=label=>{wallet.accounts=[options[label]];for(const listener of listeners)listener({accounts:wallet.accounts});};
  window.addEventListener('wallet-standard:app-ready',event=>event.detail.register(wallet));
 },Object.values(fixture.accounts).map(({label,wallet,publicKeyBytes})=>({label,wallet,publicKeyBytes})));
}
const fact=(page,label)=>page.locator('dt').filter({hasText:new RegExp('^'+label+'$')}).locator('..').locator('dd');
async function screenshot(page,name){if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.SCREENSHOT_DIR,name+'.png')});}}

/** Genuine local API/session reads; only a message-signing synthetic provider is
 * installed. Each viewport gets a fresh database and normal auth quota. */
export async function checkMemberEvidence({browser}){
 for(const width of [360,390,768,1440]){
  const fixture=await createMemberEvidenceFixture(),{origin}=fixture,page=await browser.newPage({viewport:{width,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await installWallet(page,fixture);
  try{
   await page.goto(origin+'/earn');
   for(const label of ['minimum','capped','bounded']){
    await page.evaluate(label=>window.chooseMemberAccount(label),label);
    await page.locator('#wallet-button').click();await page.getByRole('button',{name:'Connect Synthetic Member',exact:true}).click();
    await page.getByRole('button',{name:'Sign in with this message',exact:true}).click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});
    await page.getByRole('navigation').getByRole('link',{name:'Earn',exact:true}).click();await page.getByRole('heading',{name:'Your Earn evidence',exact:true}).waitFor();await page.locator('#view[aria-busy=false]').waitFor();
    if(label==='bounded'){
     await page.getByText('Finalized ownership, purchase and streak evidence is unavailable. No zero-valued multiplier preview is inferred.',{exact:true}).waitFor();
     assert.equal(await fact(page,'Overall multiplier').count(),0);assert.equal(await page.getByText('synthetic-capped-components',{exact:true}).count(),0);
    }else{
     assert.equal(await fact(page,'Overall multiplier').textContent(),label==='minimum'?'0.1×':'10×');
     assert.equal(await fact(page,'Rolling streak days').textContent(),label==='minimum'?'0':'10');
     assert.equal(await fact(page,'Highest eligible NFT Level').textContent(),label==='minimum'?'0':'10');
     assert.equal(await fact(page,'Purchase token-days').textContent(),label==='minimum'?'0':'99');
     await page.getByText(label==='minimum'?'synthetic-minimum-reset-components':'synthetic-capped-components',{exact:true}).waitFor();
    }
    await page.getByText('Synthetic active action · '+(label==='capped'?'verified':'pending'),{exact:true}).waitFor();
    assert.equal(await page.getByText('Synthetic retired action',{exact:true}).count(),0);
    if(label!=='capped')assert.ok(!(await page.locator('#view').textContent()).includes('synthetic-private-completion'));
    assert.match(await page.locator('#view').textContent(),/board-not-sealed/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Earn overflow '+label+' '+width);
    await screenshot(page,'member-earn-'+label+'-'+width);
    await page.getByRole('navigation').getByRole('link',{name:'Vault',exact:true}).click();await page.getByRole('heading',{name:'Combined local Vault allocations',exact:true}).waitFor();
    const vault=await (await page.request.get(origin+'/api/v1/vault')).json();
    if(label==='minimum'){
     assert.equal(vault.summary.assetCount,26);await page.getByText(/Complete local ledger snapshot across 26 owned NFTs/).waitFor();
     await page.getByText('26000 allocated · 13000 vested · 0 claimed · 13000 available base units',{exact:true}).waitFor();
     const next=page.getByRole('link',{name:'Next holdings →',exact:true});await next.focus();await page.keyboard.press('Enter');
     await page.getByRole('link',{name:/synthetic-minimum-025/}).waitFor();assert.equal(await page.getByRole('link',{name:/synthetic-minimum-000/}).count(),0);
     await page.getByText(/Complete local ledger snapshot across 26 owned NFTs/).waitFor();
     await page.goBack();await page.getByRole('link',{name:/synthetic-minimum-000/}).waitFor();
     await page.getByRole('link',{name:/synthetic-minimum-000/}).click();await page.getByRole('heading',{name:'Allocations for synthetic-minimum-000',exact:true}).waitFor();
     await page.getByText('Original allocation vesting clocks',{exact:true}).click();
     assert.match(await page.locator('#view').textContent(),new RegExp(new Date(fixture.activation).toISOString().slice(0,16).replace('T',' ')));
     await page.getByText(/Fiat pricing is unavailable/).waitFor();
    }else{
     assert.equal(vault.summary.reason,label==='capped'?'concealed-metadata':'asset-bound');assert.deepEqual(vault.summary.items,[]);
     await page.getByText('Combined amounts unavailable: '+vault.summary.reason+'. No visible-page subtotal is presented.',{exact:true}).waitFor();
     assert.equal(await page.getByText(/26000 allocated/).count(),0);
     if(label==='capped'){
      const hidden=await page.request.get(origin+'/api/v1/nfts/synthetic-concealed/vault');assert.equal(hidden.status(),409);
      const html=await (await page.request.get(origin+'/nfts/synthetic-concealed')).text();assert.doesNotMatch(html,/Synthetic concealed (model|backdrop|symbol)|Level 10/);
     }
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Vault overflow '+label+' '+width);
    await screenshot(page,'member-vault-'+label+'-'+width);
    await page.locator('#wallet-button').click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});
    await page.getByRole('navigation').getByRole('link',{name:'Earn',exact:true}).click();await page.locator('#view[aria-busy=false]').waitFor();
    assert.equal(await page.getByText(/synthetic-(minimum-reset|capped)-components/).count(),0);assert.equal(await page.getByRole('heading',{name:'Your Earn evidence',exact:true}).count(),0);
   }
   assert.deepEqual(errors,[]);console.log(width+'px real-API Earn minimum/cap/reset/rotation/provenance and Vault complete/concealed/bounded snapshots passed.');
  }finally{await page.close();await fixture.close();}
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.PLAYWRIGHT_MODULE||!process.env.BROWSER_EXE)throw Error('Set PLAYWRIGHT_MODULE and BROWSER_EXE to installed local dependencies.');
 const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE),browser=await chromium.launch({executablePath:process.env.BROWSER_EXE,headless:true});
 try{await checkMemberEvidence({browser});}finally{await browser.close();}
}
