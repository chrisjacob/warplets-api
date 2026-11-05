import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createServer as httpServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {makeCapabilities} from '../../contracts/capabilities.mjs';

test('pair review keeps exact per-token history, pagination limits and unavailable ownership/capability states',async t=>{
 const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:{server:httpServer()}},appType:'custom',logLevel:'error'});t.after(()=>vite.close());
 const {ProgressionAssetContext}=await vite.ssrLoadModule('/src/progression-review.tsx');
 const at='2026-11-06T00:00:00.000Z',asset={id:'synthetic-target',inventoryId:'synthetic-season',owner:'owner-a',revealStatus:'revealed',level:3,version:7,rerolls:2,nextRerollAt:at,expiresAt:at,ownerObservedAt:at};
 const row=(marketId,allocated,claimed)=>({marketId,allocated,claimed,vested:allocated,claimable:(BigInt(allocated)-BigInt(claimed)).toString(),manifestDigest:'a'.repeat(64),activatedAt:at,cliffEndsAt:at,fullyVestedAt:at});
 const page={items:[row('synthetic-token-a','18446744073709551600','1'),row('synthetic-token-b','200','9')],asOf:at,nextCursor:'next-page'};
 function render({value=asset,wallet='owner-a',unsupported=false,history=page}={}){
  const capabilities=makeCapabilities('node-reference');if(unsupported)capabilities.features=capabilities.features.filter(feature=>feature.id!=='vault-preview');
  const cache=new QueryClient();cache.setQueryData(['runtime-capabilities','/api/v1',1],capabilities);
  cache.setQueryData(['private',wallet,'solana','progression-vault',value.id,value.version],history);
  const html=renderToStaticMarkup(createElement(QueryClientProvider,{client:cache},createElement(ProgressionAssetContext,{asset:value,wallet,label:'Target'})));
  cache.clear();return html;
 }
 const html=render();assert.match(html,/18446744073709551600/);assert.match(html,/18446744073709551599/);assert.match(html,/synthetic-token-a/);assert.match(html,/synthetic-token-b/);
 assert.match(html,/first allocation page/);assert.doesNotMatch(html,/All recorded allocation rows returned|18446744073709551800/);
 assert.match(html,/Current Level<\/dt><dd>3/);assert.match(html,/Asset version<\/dt><dd>7/);assert.match(html,/Completed visual rerolls<\/dt><dd>2/);assert.match(html,/Fiat pricing is unavailable/);
 for(const value of [{...asset,owner:'owner-b'},{...asset,revealStatus:'unrevealed'}]){const unavailable=render({value});assert.match(unavailable,/details are unavailable/);assert.doesNotMatch(unavailable,/synthetic-token|18446744073709551600/);}
 const unsupported=render({unsupported:true});assert.match(unsupported,/unavailable in the connected runtime/);assert.doesNotMatch(unsupported,/synthetic-token|18446744073709551600/);
 const empty=render({history:{...page,items:[],nextCursor:null}});assert.match(empty,/All recorded allocation rows returned/);assert.match(empty,/No allocation rows are recorded/);assert.doesNotMatch(empty,/0 SOL|0 USD/);
});
