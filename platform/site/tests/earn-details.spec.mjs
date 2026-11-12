import test from 'node:test';
import assert from 'node:assert/strict';
import {sign} from 'node:crypto';
import {createServer} from 'vite';
import {createServer as httpServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createMemberEvidenceFixture} from '../../application/fixtures/member-evidence.mjs';
import {encode58} from '../../server/base58.mjs';

async function actor(fixture,account){
 let cookie='';
 const call=async(path,body)=>{
  const response=await fetch(fixture.origin+'/api/v1'+path,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{origin:fixture.origin,'content-type':'application/json',cookie}});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  const value=await response.json();assert.equal(response.ok,true,JSON.stringify(value));return value;
 };
 const challenge=await call('/auth/challenges',{wallet:account.wallet});
 await call('/auth/verify',{nonce:challenge.nonce,signature:encode58(sign(null,Buffer.from(challenge.message),account.privateKey))});return call;
}
test('real owner API distinguishes sealed minimum/reset, capped provenance, rotated actions and pending evidence',async t=>{
 const f=await createMemberEvidenceFixture();t.after(()=>f.close());
 const minimum=await actor(f,f.accounts.minimum),capped=await actor(f,f.accounts.capped),pending=await actor(f,f.accounts.bounded);
 const min=(await minimum('/earn/me')).memberStatus,max=(await capped('/earn/me')).memberStatus,unknown=(await pending('/earn/me')).memberStatus;
 assert.equal(min.latestFinalComponents.multiplierTenths,1);assert.equal(min.latestFinalComponents.streakDays,0);
 assert.equal(min.latestFinalComponents.sourceRef,'synthetic-minimum-reset-components');assert.equal(min.admission.items[0].status,'eligible');
 assert.equal(max.latestFinalComponents.multiplierTenths,100);assert.equal(max.latestFinalComponents.highestEligibleLevel,10);assert.equal(max.latestFinalComponents.purchaseTokenDays,99);
 assert.deepEqual(min.actions.items.map(i=>[i.actionId,i.status]),[['synthetic-active-action','pending']]);
 assert.deepEqual(max.actions.items.map(i=>[i.actionId,i.status]),[['synthetic-active-action','verified']]);
 assert.equal(min.actions.items[0].sourceRef,null);assert.match(max.actions.items[0].sourceRef,/synthetic-private/);
 assert.equal(unknown.latestFinalComponents,null);assert.equal(unknown.admission.items[0].stakeMicroUsd,null);assert.equal(unknown.currentCutoff.status,'pending');
 const vite=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),server:{middlewareMode:true,hmr:{server:httpServer()}},appType:'custom',logLevel:'error'});t.after(()=>vite.close());
 const {EarnMemberDetails}=await vite.ssrLoadModule('/src/earn-details.tsx');
 const {ExperienceProvider}=await vite.ssrLoadModule('/src/experience.tsx');
 const render=status=>renderToStaticMarkup(createElement(ExperienceProvider,{initialTechnical:true},createElement(EarnMemberDetails,{status})));
 assert.match(render(min),/0.1×/);assert.doesNotMatch(render(min),/synthetic-private-completion|Synthetic retired action/);
 assert.match(render(max),/10×/);assert.match(render(max),/synthetic-capped-components/);
 assert.match(render(unknown),/No zero-valued multiplier preview is inferred/);assert.doesNotMatch(render(unknown),/synthetic-capped-components/);
});

test('real Vault API withholds concealed and exceeded-bound totals, while complete totals span pagination and retain original clocks',async t=>{
 const f=await createMemberEvidenceFixture();t.after(()=>f.close());
 const minimum=await actor(f,f.accounts.minimum),capped=await actor(f,f.accounts.capped),bounded=await actor(f,f.accounts.bounded);
 const first=await minimum('/vault'),second=await minimum('/vault?cursor='+first.nextCursor);
 assert.equal(first.items.length,25);assert.equal(second.items.length,1);assert.equal(first.summary.assetCount,26);assert.deepEqual(second.summary,first.summary);
 assert.equal(first.summary.items[0].allocated,'26000');assert.equal(first.summary.items[0].claimable,'13000');
 const detail=await minimum('/nfts/'+first.items[0].id+'/vault');assert.equal(detail.items[0].activatedAt,new Date(f.activation).toISOString());
 assert.equal(detail.items[0].cliffEndsAt,new Date(f.activation+86400000).toISOString());assert.equal(detail.ownerObservedAt,new Date(f.nowMs-3600000).toISOString());
 for(const [call,reason] of [[capped,'concealed-metadata'],[bounded,'asset-bound']]){const value=await call('/vault');assert.equal(value.summary.reason,reason);assert.equal(value.summary.assetCount,null);assert.deepEqual(value.summary.items,[]);}
 const hidden=await fetch(f.origin+'/api/v1/nfts/synthetic-concealed/vault');assert.equal(hidden.status,409);
 const html=await (await fetch(f.origin+'/nfts/synthetic-concealed')).text();assert.doesNotMatch(html,/Synthetic concealed (model|backdrop|symbol)|Level 10/);
});
