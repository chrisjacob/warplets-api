import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { encode58 } from '../server/base58.mjs';
import { importMarket } from '../markets/catalog.mjs';
import { observeAsset, recordVaultManifest } from '../vault/ledger.mjs';
import { observeFarm, seedFarm } from '../stake/farms.mjs';
import { seedBallot } from '../governance/ballots.mjs';
import { addCampaign, recordStakeRead } from '../earn/workflow.mjs';

/** Disposable key signs only local QA challenges for this one browser and origin.
 * No browser extension, external service or on-chain submission is involved.
 */
export async function checkMemberPages({ browser, db, origin }) {
  const keys=generateKeyPairSync('ed25519');
  const wallet=encode58(keys.publicKey.export({format:'der',type:'spki'}).subarray(-32));
  const now=Date.now(), start=Math.floor(now/1000)*1000-3*86_400_000;
  const startIso=new Date(start).toISOString();
  const key=n=>encode58(Buffer.alloc(32,n));
  importMarket(db,{id:'browser-att',symbol:'BROWSERATT',ogSymbol:'BROWSEROG',attMint:key(1),
    ogMint:key(2),poolAddress:key(3),activatedAt:startIso});
  addCampaign(db,{tokenId:'browser-att',activationMs:start,originalUnits:'402600000'});
  recordStakeRead(db,{wallet,tokenId:'browser-att',observedMs:now,expiresMs:now+300_000,
    microUsd:'10000000',sourceRef:'browser-earn-position'});
  recordVaultManifest(db,{marketId:'browser-att',originalUnits:'402600000'});
  observeAsset(db,{eventId:'browser-bind',assetId:'browser-genesis',kind:'bind',at:startIso,
    owner:wallet,slot:{kind:'genesis',tranche:1,level:1,ordinal:3}});
  seedFarm(db,{marketId:'browser-att',originalUnits:'402600000',treasuryFeeBps:100});
  observeFarm(db,{id:'browser-deposit',marketId:'browser-att',kind:'deposit',at:startIso,wallet,amount:'1234'});
  seedBallot(db,{id:'browser-vote',opensAt:now-60_000,currentTrancheOpenedAt:start,holders:[wallet],nextWhitelist:[]});

  const page=await browser.newPage({viewport:{width:390,height:900}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort());
  await page.exposeFunction('signPreviewChallenge',message=>{
    assert.ok(message.startsWith(origin+' requests a 10X.MEME wallet signature.\nAction: Sign in to the local preview\n'));
    return [...sign(null,Buffer.from(message),keys.privateKey)];
  });
  await page.addInitScript(address=>{
    window.solana={ publicKey:address, connect:async()=>({publicKey:address}),
      signMessage:async bytes=>({signature:new Uint8Array(await window.signPreviewChallenge(new TextDecoder().decode(bytes)))}) };
  },wallet);
  try {
    await page.goto(origin+'/collect');
    await page.locator('#wallet-button').click();
    await page.getByRole('button',{name:'Connect Solana wallet'}).click();
    await page.getByRole('button',{name:'Sign in with this message'}).click();
    await page.locator('dialog').waitFor({state:'hidden'});
    await page.getByLabel('As soon as possible',{exact:true}).check();
    await page.getByRole('button',{name:'Submit advisory vote'}).click();
    await page.getByText('Recorded your vote: As soon as possible.').waitFor();
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM genesis_votes').get().count,1);
    await page.goto(origin+'/earn');
    await page.getByLabel('Content URL').fill('https://example.com/qa-contribution');
    await page.getByRole('button',{name:'Submit contribution'}).click();
    await page.getByText('Contribution recorded for moderation.').waitFor();
    await page.getByText('https://example.com/qa-contribution').waitFor();
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM earn_submissions').get().count,1);
    await page.goto(origin+'/vault');
    await page.getByRole('link',{name:/browser-genesis/}).click();
    await page.getByRole('heading',{name:'Allocations for browser-genesis'}).waitFor();
    assert.ok((await page.locator('table').textContent()).includes('1000'));
    await page.goto(origin+'/stake?farm=browser-att');
    await page.getByRole('heading',{name:'Your positions'}).waitFor();
    await page.getByRole('cell',{name:'1234',exact:true}).waitFor();
    await page.locator('#wallet-button').click();
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.locator('dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#wallet-name').textContent(),'Connect wallet');
    assert.equal(await page.getByRole('cell',{name:'1234',exact:true}).count(),0);
    await page.reload();
    await page.locator('#view[aria-busy=false]').waitFor();
    assert.equal(await page.getByRole('cell',{name:'1234',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    console.log('Verified wallet session, advisory vote receipt, Earn submission, NFT entitlement and farm position; sign-out removes private state.');
  } finally {
    await page.close();
  }
}
