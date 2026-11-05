import test from 'node:test';
import assert from 'node:assert/strict';
import { policy } from '../contracts/policy.mjs';
import { handleWeb } from './handler.mjs';
import { validateChallenge, findSigningWallet, encodeSignature } from './wallet.mjs';
import { feeChart, marketsView, earnView, collectView, vaultView } from './views.mjs';

const request=(path,method='GET')=>new Request('http://localhost'+path,{method});
test('all five public routes have keyboard navigation, viewport support and same-origin assets', async()=>{
  for(const path of ['/','/markets','/vault','/stake','/earn','/collect']){
    const response=await handleWeb(request(path));
    assert.equal(response.status,200);
    assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
    const html=await response.text();
    assert.match(html,/Skip to content/);
    assert.match(html,/name="viewport"/);
    for(const nav of ['markets','vault','stake','earn','collect']) assert.ok(html.includes('href="/'+nav+'"'));
    assert.doesNotMatch(html,/https?:\/\//);
  }
  assert.strictEqual(await handleWeb(request('/api/v1/policy')),null);
  assert.strictEqual(await handleWeb(request('/assets/other.js')),null);
  assert.equal((await handleWeb(request('/','POST'))).status,405);
  const css=await handleWeb(request('/assets/10x.css','HEAD'));
  assert.match(css.headers.get('content-type'),/text\/css/);
  assert.equal(await css.text(),'');
});

test('fee chart presents samples from API; absent or malformed data remains unavailable',()=>{
  const samples={points:[{elapsedSeconds:0,feeBps:9123},{elapsedSeconds:24,feeBps:5010},{elapsedSeconds:90,feeBps:100}]};
  const chart=feeChart(samples,1);
  assert.match(chart,/50\.1%/);
  assert.match(chart,/24 seconds/);
  assert.match(chart,/input type="range"/);
  for (const broken of [null,{}, {points:[]},{points:[{elapsedSeconds:0,feeBps:9100},{elapsedSeconds:0,feeBps:9000}]}]) {
    assert.match(feeChart(broken),/unavailable/);
  }
});

test('rendered API content is escaped; missing market data differs from a verified empty set',()=>{
  assert.match(marketsView({policy,markets:null,schedule:null}),/Market data is unavailable/);
  assert.match(marketsView({policy,markets:{items:[]}}),/No markets yet/);
  const view=marketsView({policy,markets:{items:[{id:'safe',symbol:'<b>X</b>',ogSymbol:'A&B',source:'local-fixture'}]}});
  assert.match(view,/&lt;b&gt;X&lt;\/b&gt;/);assert.match(view,/A&amp;B/);assert.match(view,/Local fixture/);
  assert.doesNotMatch(view,/<b>X<\/b>/);
});

test('board state prevents a pending board from being displayed as a finalized empty burn',()=>{
  const render=board=>earnView({policy,date:'2026-11-04',board});
  assert.match(render(null),/leaderboard is unavailable/);
  assert.match(render({status:'pending',items:[]}),/Awaiting final scores/);
  assert.match(render({status:'final',items:[]}),/Final board · no winners/);
  const output=render({status:'final',items:[{wallet:'wallet',rank:1,contentScore:9,multiplierTenths:13,pointsTenths:117}]});
  assert.match(output,/1\.3×/);assert.match(output,/11\.7/);
});

test('collection terms and vest periods follow returned policy',()=>{
  const fixture={items:[{...policy.genesis,id:'genesis',cap:7777,firstWhitelistPriceSol:'0.12'},
    {...policy.season,id:'seasons'}]};
  assert.match(collectView({collections:fixture}),/7,777/);
  assert.match(collectView({collections:fixture}),/0\.12 SOL/);
  assert.match(collectView({collections:null}),/unavailable/);
  assert.match(vaultView({policy:{...policy,vault:{cliffHours:11,vestHours:23}}}),/After 34 hours/);
});

test('wallet adapter is feature gated and sign-in message binds exact current origin, wallet and expiry',()=>{
  assert.equal(findSigningWallet({solana:{connect(){}}}),null);
  const adapter={connect(){},signMessage(){}};
  assert.equal(findSigningWallet({solana:adapter}),adapter);
  const nonce='A'.repeat(43),expiresAt='2026-11-04T00:05:00.000Z',origin='http://localhost:4173',wallet='wallet';
  const challenge={nonce,expiresAt,message:[origin+' requests a 10X.MEME wallet signature.',
    'Action: Sign in to the local preview','Chain: solana','Wallet: '+wallet,'Nonce: '+nonce,
    'Issued: 2026-11-04T00:00:00.000Z','Expires: '+expiresAt].join('\n')};
  validateChallenge(challenge,wallet,origin,Date.parse(expiresAt)-1);
  assert.throws(()=>validateChallenge(challenge,wallet,'http://other',Date.parse(expiresAt)-1));
  assert.throws(()=>validateChallenge(challenge,'different',origin,Date.parse(expiresAt)-1));
  assert.throws(()=>validateChallenge(challenge,wallet,origin,Date.parse(expiresAt)));
  assert.throws(()=>encodeSignature(new Uint8Array(5)));
  assert.equal(encodeSignature(new Uint8Array(64)),'1'.repeat(64));
  const bytes=new Uint8Array(64);bytes[63]=1;
  assert.equal(encodeSignature(bytes),'1'.repeat(63)+'2');
});
