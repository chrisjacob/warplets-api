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
  await page.exposeFunction('signStandardChallenge',message=>{
    assert.ok(message.startsWith(origin+' requests a 10X.MEME wallet signature.\nAction: Sign in to the local preview\n'));
    signatures++;
    return [...sign(null,Buffer.from(message),pair.privateKey)];
  });
  await page.addInitScript(({address,bytes})=>{
    const account={address,publicKey:new Uint8Array(bytes),chains:['solana:localnet'],features:['solana:signMessage']};
    const wallet={name:'QA Standard',version:'1.0.0',icon:'data:image/svg+xml,<svg/>',chains:['solana:localnet'],accounts:[account],
      features:{
        'standard:connect':{version:'1.0.0',connect:async()=>({accounts:[account]})},
        'solana:signMessage':{version:'1.0.0',signMessage:async({message})=>[{
          signature:new Uint8Array(await window.signStandardChallenge(new TextDecoder().decode(message))),
          signedMessage:window.tamperStandardMessage?new Uint8Array([1]):message,
        }]},
      }};
    window.addEventListener('wallet-standard:app-ready',event=>event.detail.register(wallet));
  },{address,bytes:[...bytes]});
  try{
    await page.goto(origin+'/markets');
    await page.locator('#wallet-button').click();
    await page.getByRole('button',{name:'Connect QA Standard'}).click();
    await page.evaluate(()=>{window.tamperStandardMessage=true;});
    await page.getByRole('button',{name:'Sign in with this message'}).click();
    await page.getByText('The wallet changed the sign-in message.').waitFor();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE wallet=?').get(address).n,0);
    await page.evaluate(()=>{window.tamperStandardMessage=false;});
    await page.getByRole('button',{name:'Sign in with this message'}).click();
    await page.locator('#wallet-dialog').waitFor({state:'hidden'});
    assert.equal(signatures,2);
    await page.locator('#wallet-button').click();
    await page.getByText('Find a transaction receipt').click();
    await page.getByLabel('Transaction ID').fill(intent.id);
    await page.getByRole('button',{name:'Find receipt',exact:true}).click();
    await page.getByText('claim · validated').waitFor();
    await page.getByText('rehearsal-only',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Sign out'}).click();
    await page.locator('#wallet-dialog').waitFor({state:'hidden'});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE wallet=?').get(address).n,0);
    console.log('Wallet Standard registration, bound message verification, tamper rejection, private receipt recovery and logout passed.');
  }finally{await page.close();}
}
