import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { encode58 } from '../../server/base58.mjs';
import { createIntent } from '../../transactions/intents.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openDatabase } from '../../storage/database.mjs';
import { createApp } from '../../server/application.mjs';
import { createLocalServer } from '../../server/start.mjs';
import { serveSite } from '../serve.mjs';

/** This isolated Wallet Standard provider has no sendTransaction feature. It
 * signs only a challenge from the test server and exists for one browser page.
 */
export async function checkStandardWallet({browser,origin,db}){
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const pair=generateKeyPairSync('ed25519');
  const bytes=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32);
  const address=encode58(bytes), now=Date.now();
  const intent=createIntent(db,{owner:address,requestKey:'studio-recovery',plan:{
    network:'solana-local',action:'claim',subject:'rehearsal-only',expiresMs:now+120_000,
    maximumFeeUnits:'5000',minimumOutputUnits:'10',signers:[address],
    instructions:[{program:encode58(Buffer.alloc(32,9)),accounts:[],data:'01'}],
  }},now);
  let signatures=0;
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.exposeFunction('signStandardChallenge',message=>{
    assert.ok(message.startsWith(origin+' requests a 10X.MEME wallet signature.\nAction: Sign in to the local preview\n'));
    signatures++;
    return [...sign(null,Buffer.from(message),pair.privateKey)];
  });
  await page.addInitScript(({address,bytes})=>{
    const account={address,publicKey:new Uint8Array(bytes),chains:['solana:localnet'],features:['solana:signMessage']};
    const listeners=new Set();
    const wallet={name:'QA Standard',version:'1.0.0',icon:'data:image/svg+xml,<svg/>',chains:['solana:localnet'],accounts:[account],
      features:{
        'standard:connect':{version:'1.0.0',connect:async()=>({accounts:wallet.accounts})},
        'standard:events':{version:'1.0.0',on:(_event,listener)=>{listeners.add(listener);return()=>listeners.delete(listener);}},
        'solana:signMessage':{version:'1.0.0',signMessage:async({message})=>{if(window.rejectStandardMessage)throw Error('Fixture user rejected signing.');
          if(window.delayStandardMessage)await new Promise(resolve=>{window.releaseStandardMessage=resolve;});
          return [{
          signature:new Uint8Array(await window.signStandardChallenge(new TextDecoder().decode(message))),
          signedMessage:window.tamperStandardMessage?new Uint8Array([1]):message,
        }];}},
      }};
    window.selectStandardAccount=(changed=false)=>{
      wallet.accounts=changed?[]:[account];
      for(const listener of listeners)listener({accounts:wallet.accounts});
    };
    window.addEventListener('wallet-standard:app-ready',event=>{window.unregisterStandardWallet=event.detail.register(wallet);});
  },{address,bytes:[...bytes]});
  try{
    await page.goto(origin+'/markets');
    await page.locator('#wallet-button').click();
    await page.getByRole('button',{name:'Connect QA Standard'}).click();
    await page.getByRole('button',{name:'Sign in with this message'}).waitFor();
    await page.evaluate(()=>window.selectStandardAccount(true));
    await page.getByRole('button',{name:'Sign in with this message'}).waitFor({state:'hidden'});
    assert.equal(signatures,0,'account change must cancel the pending challenge');
    await page.evaluate(()=>window.selectStandardAccount());
    await page.getByRole('button',{name:'Connect QA Standard'}).click();
    await page.evaluate(()=>{window.rejectStandardMessage=true;});
    await page.getByRole('button',{name:'Sign in with this message'}).click();
    await page.getByText('Fixture user rejected signing.').waitFor();
    assert.equal(signatures,0);
    await page.evaluate(()=>{window.rejectStandardMessage=false;window.tamperStandardMessage=true;});
    await page.getByRole('button',{name:'Sign in with this message'}).click();
    await page.getByText('The wallet changed the sign-in message.').waitFor();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE wallet=?').get(address).n,0);
    await page.evaluate(()=>{window.tamperStandardMessage=false;window.delayStandardMessage=true;});
    await page.getByRole('button',{name:'Sign in with this message'}).click();
    await page.waitForFunction(()=>typeof window.releaseStandardMessage==='function');
    await page.evaluate(()=>{window.selectStandardAccount(true);window.releaseStandardMessage();window.delayStandardMessage=false;});
    await page.getByRole('button',{name:'Sign in with this message'}).waitFor({state:'hidden'});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE wallet=?').get(address).n,0);
    await page.evaluate(()=>window.selectStandardAccount());
    await page.getByRole('button',{name:'Connect QA Standard'}).click();
    await page.getByRole('button',{name:'Sign in with this message'}).click();
    await page.locator('#wallet-dialog').waitFor({state:'hidden'});
    assert.equal(signatures,3);
    await page.locator('#wallet-button').click();
    await page.evaluate(()=>window.selectStandardAccount(true));
    await page.getByText(/This session remains authenticated as/).waitFor();
    await page.getByText('Verified Solana wallet: '+address,{exact:true}).waitFor();
    await page.evaluate(()=>window.selectStandardAccount());
    await page.getByText('Local inbox settings',{exact:true}).click();
    await page.getByLabel('Market launches',{exact:true}).check();
    await page.getByRole('button',{name:'Enable local inbox'}).click();
    await page.getByText('No local notices',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Turn off and clear inbox'}).click();
    await page.getByRole('button',{name:'Enable local inbox'}).waitFor();
    assert.equal(db.prepare('SELECT enabled FROM notice_preferences WHERE wallet=?').get(address).enabled,0);
    await page.getByText('Find a transaction receipt').click();
    await page.getByLabel('Transaction ID').fill(intent.id);
    await page.getByRole('button',{name:'Find receipt',exact:true}).click();
    await page.getByText('claim · validated').waitFor();
    await page.getByText('rehearsal-only',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Sign out'}).click();
    await page.locator('#wallet-dialog').waitFor({state:'hidden'});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE wallet=?').get(address).n,0);
    await page.locator('#wallet-button').click();
    await page.getByRole('button',{name:'Connect QA Standard'}).click();
    await page.getByRole('button',{name:'Sign in with this message'}).waitFor();
    await page.getByRole('button',{name:'Sign in with this message'}).click();
    await page.locator('#wallet-dialog').waitFor({state:'hidden'});
    await page.locator('#wallet-button').click();
    await page.getByText('Find a transaction receipt').click();
    await page.getByLabel('Transaction ID').fill(intent.id);
    await page.getByRole('button',{name:'Find receipt',exact:true}).click();
    await page.getByText('rehearsal-only',{exact:true}).waitFor();
    db.prepare('DELETE FROM sessions WHERE wallet=?').run(address);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByText('Verified Solana wallet: '+address,{exact:true}).waitFor({state:'hidden'});
    await page.getByText('rehearsal-only',{exact:true}).waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Connect QA Standard'}).click();
    await page.getByRole('button',{name:'Sign in with this message'}).waitFor();
    await page.evaluate(()=>window.unregisterStandardWallet());
    await page.getByRole('button',{name:'Sign in with this message'}).waitFor({state:'hidden'});
    await page.getByRole('button',{name:'Connect QA Standard'}).waitFor({state:'hidden'});
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'wallet-button');
    console.log('Wallet Standard account/disconnect events, rejected signature, unregister cancellation, registration, bound message verification, tamper rejection, private receipt recovery and logout passed.');
  }finally{await page.close();}
  await checkWalletBoundaries({browser});
}

/** B18 uses fresh databases to isolate each viewport's real authentication rate
 * budget. Only disposable message keys exist; no transaction-sign/send feature.
 * Browser clock override exercises client challenge expiry; SQL expiry exercises
 * the real server guard separately. Neither modifies production timing policy. */
export async function checkWalletBoundaries({browser}){
 const results=[];
 for(const width of [360,390,768,1440]){
  const db=openDatabase(':memory:'),api=createApp(db),server=createLocalServer(async(request,peer)=>await serveSite(request,undefined,path=>api(new Request(new URL(path,request.url)),peer))??api(request,peer));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const keys=[0,1].map(()=>{let pair,address,bytes;do{pair=generateKeyPairSync('ed25519');bytes=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32);address=encode58(bytes);}while(address.length!==44);return {pair,address,bytes};});
  const [a,b]=keys.map(k=>k.address),now=Date.now(),intent=createIntent(db,{owner:a,requestKey:'b18-original',plan:{network:'solana-local',action:'claim',subject:'b18-original-receipt',expiresMs:now+120000,maximumFeeUnits:'5000',minimumOutputUnits:'10',signers:[a],instructions:[{program:encode58(Buffer.alloc(32,9)),accounts:[],data:'01'}]}},now);
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'}),errors=[];let signatures=0,verifyCalls=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();if(url.pathname==='/api/v1/auth/verify')verifyCalls++;return route.continue();});
  await page.exposeFunction('b18Sign',({message,address})=>{assert.ok(message.startsWith(origin+' requests a 10X.MEME wallet signature.\nAction: Sign in to the local preview\n'));assert.ok(message.includes('\nWallet: '+address+'\n'));const key=keys.find(k=>k.address===address);assert.ok(key);signatures++;return [...sign(null,Buffer.from(message),key.pair.privateKey)];});
  await page.addInitScript(accounts=>{
   const listeners=new Set(),supported=accounts.map(x=>({...x,publicKey:new Uint8Array(x.publicKey),chains:['solana:localnet'],features:['solana:signMessage']}));let registry;
   const wallet={name:'B18 Standard',version:'1.0.0',icon:'data:image/svg+xml,<svg/>',chains:['solana:localnet'],accounts:[supported[0]],features:{'standard:connect':{version:'1.0.0',connect:async()=>({accounts:wallet.accounts})},'standard:events':{version:'1.0.0',on:(_e,cb)=>{listeners.add(cb);return()=>listeners.delete(cb);}},'solana:signMessage':{version:'1.0.0',signMessage:async({account,message})=>[{signature:new Uint8Array(await window.b18Sign({message:new TextDecoder().decode(message),address:account.address})),signedMessage:message}]}}};
   const unsupported={...wallet,name:'B18 No Message',features:{'standard:connect':wallet.features['standard:connect']}};
   window.b18Select=(index,noMessage=false)=>{wallet.accounts=[noMessage?{...supported[index],features:[]}:supported[index]];for(const cb of listeners)cb({accounts:wallet.accounts});};
   window.b18Register=()=>{window.b18Unregister=registry.register(wallet);};
   window.addEventListener('wallet-standard:app-ready',e=>{registry=e.detail;registry.register(unsupported);});
   window.b18RealNow=Date.now;
  },keys.map(k=>({address:k.address,publicKey:[...k.bytes]})));
  const review=async()=>{await page.getByRole('button',{name:'Connect B18 Standard',exact:true}).click();await page.getByRole('button',{name:'Sign in with this message',exact:true}).waitFor();};
  const signin=async()=>{await review();await page.getByRole('button',{name:'Sign in with this message',exact:true}).click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});await page.locator('#wallet-button').click();};
  const receipt=async()=>{await page.getByText('Find a transaction receipt',{exact:true}).click();await page.getByLabel('Transaction ID',{exact:true}).fill(intent.id);await page.getByRole('button',{name:'Find receipt',exact:true}).click();};
  const screenshot=async name=>{if(process.env.SCREENSHOT_DIR){await mkdir(process.env.SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.SCREENSHOT_DIR,'wallet-'+name+'-'+width+'.png')});}};
  try{
   await page.goto(origin+'/markets');await page.locator('#view[aria-busy=false]').waitFor();await page.locator('#wallet-button').focus();await page.keyboard.press('Enter');
   await page.getByText('Open the preview in a browser with a Solana wallet that supports message signing.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Connect B18 No Message'}).count(),0);
   await page.evaluate(()=>window.b18Register());await page.getByRole('button',{name:'Connect B18 Standard',exact:true}).waitFor();
   await page.evaluate(()=>window.b18Select(0,true));await page.getByRole('button',{name:'Connect B18 Standard',exact:true}).click();await page.getByText('Choose a Solana account that supports sign-in messages.',{exact:true}).waitFor();assert.equal(signatures,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM auth_challenges').get().n,0);
   await page.evaluate(()=>window.b18Select(0));await review();
   assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
   const layout=await page.locator('#wallet-dialog').evaluate(d=>({pageFits:document.documentElement.scrollWidth<=innerWidth,dialogFits:d.scrollWidth<=d.clientWidth,preFits:d.querySelector('pre').scrollWidth<=d.querySelector('pre').clientWidth,animation:getComputedStyle(d).animationName,transition:getComputedStyle(d).transitionDuration}));assert.deepEqual(layout,{pageFits:true,dialogFits:true,preFits:true,animation:'none',transition:'0s'});
   // Native dialog keeps document focus inside; Chromium may cycle through browser chrome.
   const keyboardTargets=new Set();for(let i=0;i<6;i++){await page.keyboard.press('Tab');const focus=await page.evaluate(()=>({inside:document.querySelector('#wallet-dialog').contains(document.activeElement),documentFocused:document.hasFocus(),text:document.activeElement.textContent}));assert.ok(focus.inside||!focus.documentFocused,'Tab must not focus background content');if(focus.inside)keyboardTargets.add(focus.text);}assert.ok(keyboardTargets.has('×'));assert.ok(keyboardTargets.has('Sign in with this message'));
   await screenshot('message');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'wallet-button');assert.equal(signatures,0);assert.equal(verifyCalls,0);
   await page.locator('#wallet-button').click();await review();await page.evaluate(()=>{Date.now=()=>window.b18RealNow()+301000;});await page.getByRole('button',{name:'Sign in with this message',exact:true}).click();await page.getByText('This sign-in message is invalid or expired. Reconnect your wallet.',{exact:true}).waitFor();assert.equal(signatures,0);assert.equal(verifyCalls,0);await page.evaluate(()=>{Date.now=window.b18RealNow;});await page.keyboard.press('Escape');
   await page.locator('#wallet-button').click();await review();db.prepare('UPDATE auth_challenges SET expires_at=0 WHERE wallet=?').run(a);await page.getByRole('button',{name:'Sign in with this message',exact:true}).click();await page.getByText('Challenge expired or unavailable.',{exact:true}).waitFor();assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);assert.equal(signatures,1);await page.keyboard.press('Escape');
   await page.locator('#wallet-button').click();await signin();await receipt();await page.getByText('b18-original-receipt',{exact:true}).waitFor();await screenshot('receipt');
   // The extension's selected account cannot relabel the authenticated session.
   await page.evaluate(()=>window.b18Select(1));await page.getByText(/This session remains authenticated as/).waitFor();await page.getByText('Verified Solana wallet: '+a,{exact:true}).waitFor();assert.equal(await page.getByText('Verified Solana wallet: '+b,{exact:true}).count(),0);
   await page.context().setOffline(true);await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));db.prepare('DELETE FROM sessions WHERE wallet=?').run(a);await page.context().setOffline(false);const profileReturned=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/v1/me'&&r.status()===401);await page.evaluate(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('pageshow'));});await profileReturned;await page.getByText('Verified Solana wallet: '+a,{exact:true}).waitFor({state:'hidden'});await page.getByText('b18-original-receipt',{exact:true}).waitFor({state:'hidden'});
   await signin();await page.getByText('Verified Solana wallet: '+b,{exact:true}).waitFor();assert.equal(await page.getByLabel('Transaction ID').count(),1);assert.equal(await page.getByLabel('Transaction ID').inputValue(),'');await receipt();await page.getByText('b18-original-receipt',{exact:true}).waitFor({state:'hidden'});await page.getByRole('button',{name:'Retry',exact:true}).waitFor();assert.equal(db.prepare('SELECT COUNT(*) n FROM tx_intents WHERE id=?').get(intent.id).n,1);await screenshot('other-account');
   await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#wallet-dialog').waitFor({state:'hidden'});await page.evaluate(()=>window.b18Select(0));await page.locator('#wallet-button').click();await signin();await receipt();await page.getByText('b18-original-receipt',{exact:true}).waitFor();await page.getByText(intent.id,{exact:true}).waitFor();assert.equal(db.prepare('SELECT COUNT(*) n FROM tx_intents WHERE id=?').get(intent.id).n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM tx_attempts WHERE intent_id=?').get(intent.id).n,0);
   assert.deepEqual(errors,[]);results.push({width,height:900,reducedMotion:'reduce',longAddressLength:44,passedCases:12,messageSignatures:signatures,verificationCalls:verifyCalls,financialExecution:false});console.log(width+'px B18 Wallet Standard: 12 boundary cases passed (unsupported feature/account, registration, keyboard/cancel, client/server expiry, account/session identity, offline return, private-cache clearing, cross-owner rejection, original receipt recovery, long-address/reduced-motion layout).');
  }finally{await page.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
 }
 if(process.env.SCREENSHOT_DIR)await writeFile(join(process.env.SCREENSHOT_DIR,'wallet-evidence.json'),JSON.stringify({format:'10x.local.wallet-browser-evidence.v1',browserVersion:browser.version(),node:process.version,platform:process.platform,architecture:process.arch,adapter:'Synthetic Wallet Standard 1.0.0',evidenceType:'local-browser',physicalWallet:'manual-required',transactionSigning:false,broadcasting:false,results},null,2));
}
