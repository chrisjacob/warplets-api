import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { encode58 } from '../../server/base58.mjs';
import { createIntent } from '../../transactions/intents.mjs';

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
}
