import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {brand,products,firstLaunch,campaignSchedule} from '../public-content.mjs';
import {routeFor,initialPage} from '../public-pages.mjs';

test('launch presentation cannot imply a configured market, dates or monthly reward duration',()=>{
 assert.equal(firstLaunch.state,'planned');
 assert.equal(firstLaunch.contract,null);
 assert.equal(firstLaunch.chain,null);
 assert.equal(firstLaunch.seasonLabel,'Season 0');
 assert.equal(firstLaunch.collectibleSupply,1000);
 assert.equal(firstLaunch.betaMintUsd,1);
 assert.equal(firstLaunch.standardMintUsd,10);
 assert.equal(campaignSchedule(),'Dates to be confirmed');
 for(const schedule of [
  {startsAt:'2026-11-24T00:00:00Z',endsAt:null,timeZone:'UTC'},
  {startsAt:'invalid',endsAt:'2026-12-24T00:00:00Z',timeZone:'UTC'},
  {startsAt:'2026-12-24T00:00:00Z',endsAt:'2026-11-24T00:00:00Z',timeZone:'UTC'},
 ])assert.equal(campaignSchedule(schedule),'Dates to be confirmed');
 const approved={startsAt:'2027-01-02T00:00:00Z',endsAt:'2027-01-23T00:00:00Z',timeZone:'Australia/Sydney'};
 assert.match(campaignSchedule(approved),/2 Jan 2027/);assert.match(campaignSchedule(approved),/23 Jan 2027/);
 assert.match(campaignSchedule(approved),/Australia\/Sydney/);
 assert.equal(firstLaunch.pairedCampaign.startsAt,null,'Formatting a supplied fixture must not publish it');
});

test('initial public HTML preserves planned vs active identities and all product destinations',async()=>{
 const origin='http://localhost';
 for(const product of Object.values(products))assert.ok(routeFor(new URL(product.path,origin)));
 const url=new URL('/',origin),home=await initialPage(routeFor(url),url);
 assert.match(home.title,/10X Everything/);
 for(const product of Object.values(products))assert.ok(home.content.includes(product.plural));
 assert.match(home.content,/\$10X/);assert.match(home.content,/not scheduled/);
 assert.doesNotMatch(home.content,/demonstration data|local preview/i);assert.doesNotMatch(home.metadata,/social-card.png/);
 for(const status of ['planned','active','ended']){
  const url=new URL('/markets/existing-att',origin);
  const page=await initialPage(routeFor(url),url,async()=>Response.json({symbol:'EXISTINGATT',ogSymbol:'WARPLET',status,attMint:'original-mint',ogMint:'original-og',feeBps:100}));
  assert.match(page.title,/EXISTINGATT \/ WARPLET/);
  assert.ok(page.content.includes(status));
  assert.match(page.content,/Attention Token/);
  assert.doesNotMatch(page.content,/\$10X/);
 }
});

test('collectible presentation never substitutes legacy Warplet art or guessed traits for asset metadata',async t=>{
 const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:{server:httpServer()}},appType:'custom',logLevel:'error'});
 t.after(()=>vite.close());
 const {CollectionArt}=await vite.ssrLoadModule('/src/collection-art.tsx');
 const permanent=renderToStaticMarkup(createElement(CollectionArt,{name:'genesis',level:3}));
 assert.match(permanent,/10X NFT/);assert.match(permanent,/Level 3/);
 assert.doesNotMatch(permanent,/Warplet|genesis-1.webp|<img/);
 const seasonal=renderToStaticMarkup(createElement(CollectionArt,{name:'existing-season',level:2}));
 assert.match(seasonal,/10X Cards/);assert.doesNotMatch(seasonal,/Season 0|PEPE|CATE/);
 const concealed=renderToStaticMarkup(createElement(CollectionArt,{name:'secret',concealed:true,level:10}));
 assert.doesNotMatch(concealed,/Level 10/);assert.match(concealed,/Awaiting reveal/);
 const {QaTokenName}=await vite.ssrLoadModule('/src/qa-identity.tsx');
 assert.match(renderToStaticMarkup(createElement(QaTokenName,{id:'existing-att',fallback:'ACTUALATT'})),/ACTUALATT/);
 assert.match(brand.risk,/not a promise of returns/);
});
