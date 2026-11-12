import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createServer as httpServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {initialPage,routeFor} from '../public-pages.mjs';
test('collection rendering preserves unknown eligibility, concealed metadata and bounded material identity',async t=>{
 const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:{server:httpServer()}},appType:'custom',logLevel:'error'});t.after(()=>vite.close());
 const {StageEvidence,AssetEvidence,eligibleMaterials}=await vite.ssrLoadModule('/src/collection-details.tsx');
 const stage=renderToStaticMarkup(createElement(StageEvidence,{stage:{status:'awaiting-snapshot',type:'free',eligible:false}}));
 assert.match(stage,/unknown/);assert.doesNotMatch(stage,/>ineligible</);
 const hidden=renderToStaticMarkup(createElement(AssetEvidence,{asset:{revealStatus:'unrevealed',level:10,rerolls:999,expiresAt:'2099-01-01T00:00:00.000Z'}}));
 assert.doesNotMatch(hidden,/2099|999|Visual rerolls|Benefit expiry/);
 const target={id:'target',owner:'alice',inventoryId:'season',level:2,revealStatus:'revealed',version:1,expiresAt:'date'};
 const good={...target,id:'good'};
 const rejected=[target,{...good,id:'wrong-owner',owner:'bob'},{...good,id:'wrong-season',inventoryId:'other'},
  {...good,id:'hidden',revealStatus:'unrevealed'},{...good,id:'wrong-level',level:3},{...good,id:'busy',operationPending:true}];
 assert.deepEqual(eligibleMaterials([...rejected,good],target,'alice').map(a=>a.id),['good']);
 assert.deepEqual(eligibleMaterials([good],target,'bob'),[]);
});
test('public initial HTML names allocations truthfully and cannot expose concealed metadata',async()=>{
 const url=new URL('http://local/seasons/season');
 const page=await initialPage(routeFor(url),url,async()=>Response.json({data:{id:'season',kind:'season',counts:{unsold:3,paid:2},capacity:1000,seasonStart:'date'}}));
 assert.match(JSON.stringify(page),/Priced-stage allocations/);assert.doesNotMatch(JSON.stringify(page),/Paid mints/);
 const nft=new URL('http://local/nfts/hidden');
 const secret=await initialPage(routeFor(nft),nft,async()=>Response.json({data:{id:'hidden',inventoryId:'season',revealStatus:'unrevealed',level:10,traits:{model:'SECRET',backdrop:'SECRET',symbol:'SECRET'}}}));
 assert.doesNotMatch(JSON.stringify(secret),/SECRET/);
});

test('Earn renders server multiplier/provenance and keeps missing final evidence distinct from zero',async t=>{
 const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:{server:httpServer()}},appType:'custom',logLevel:'error'});t.after(()=>vite.close());
 const {EarnMemberDetails}=await vite.ssrLoadModule('/src/earn-details.tsx');
 const {ExperienceProvider}=await vite.ssrLoadModule('/src/experience.tsx');
 const renderTechnical=props=>renderToStaticMarkup(createElement(ExperienceProvider,{initialTechnical:true},createElement(EarnMemberDetails,props)));
 const status={mode:'local-fixture',asOf:'2026-11-01T00:00:00.000Z',epoch:21000,admission:{status:'complete',items:[{tokenId:'ATT',status:'pending',reason:'stake-evidence-pending',stakeMicroUsd:null,stakeObservedAt:null,sourceRef:null}]},
  actions:{status:'complete',items:[{actionId:'learn',label:'Learn fixture',verifier:'proof',status:'pending',verifiedAt:null,sourceRef:null}]},currentCutoff:{status:'pending',reason:'board-not-sealed',cutoffAt:'2026-11-01T23:59:59.999Z'},
  latestFinalComponents:null,multiplierBounds:{minimumTenths:1,maximumTenths:100}};
 const pending=renderTechnical({status});
 assert.match(pending,/0.1×/);assert.match(pending,/10×/);assert.match(pending,/No verified completion/);assert.match(pending,/No zero-valued multiplier preview/);
 const final={epoch:20999,cutoffAt:status.asOf,actionTenths:2,streakDays:3,highestEligibleLevel:4,purchaseTokenDays:5,multiplierTenths:22,sourceRef:'sealed-fixture-source',snapshotDigest:'sealed-digest'};
 const ready=renderTechnical({status:{...status,latestFinalComponents:final}});
 assert.match(ready,/2.2×/);assert.match(ready,/sealed-fixture-source/);assert.match(ready,/sealed-digest/);
});
