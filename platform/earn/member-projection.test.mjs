import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../storage/database.mjs';
import {DAY_MS} from '../domain/earn/index.mjs';
import {addCampaign,recordStakeRead,submitContent} from './workflow.mjs';
import {configureAction,recordActionCompletion} from './components.mjs';
import {readMemberStatus,finalizedMemberComponents} from './member-projection.mjs';
const epoch=21000,now=epoch*DAY_MS,principal={kind:'wallet',wallet:'alice'};
test('private status distinguishes absent/stale current stake, accepted entry and pending cutoff; scopes action evidence',t=>{
 const db=openDatabase();t.after(()=>db.close());
 addCampaign(db,{tokenId:'ATT',activationMs:now,originalUnits:'100000'});
 configureAction(db,{actionId:'learn',label:'Read fixture guide',verifier:'proof',enabled:true,effectiveEpoch:epoch,atMs:now-1});
 recordActionCompletion(db,{wallet:'alice',actionId:'learn',verifier:'proof',sourceRef:'fixture-completion',verifiedMs:now});
 assert.throws(()=>readMemberStatus(db,{kind:'anonymous'},now),e=>e.status===401);
 let status=readMemberStatus(db,principal,now);assert.equal(status.admission.items[0].status,'pending');assert.equal(status.admission.items[0].stakeMicroUsd,null);
 assert.equal(status.actions.items[0].status,'verified');assert.equal(status.latestFinalComponents,null);
 assert.equal(readMemberStatus(db,{kind:'wallet',wallet:'bob'},now).actions.items[0].sourceRef,null);
 recordStakeRead(db,{wallet:'alice',tokenId:'ATT',observedMs:now,expiresMs:now+1000,microUsd:'10000000',sourceRef:'fixture-entry'});
 assert.equal(readMemberStatus(db,principal,now).admission.items[0].status,'eligible');
 assert.equal(readMemberStatus(db,principal,now+1001).admission.items[0].status,'pending');
 submitContent(db,{wallet:'alice',tokenId:'ATT',url:'https://example.com/post',requestKey:'one',nowMs:now});
 status=readMemberStatus(db,principal,now);assert.equal(status.admission.items[0].status,'accepted');assert.equal(status.currentCutoff.status,'pending');
 configureAction(db,{actionId:'learn',label:'Read fixture guide',verifier:'proof',enabled:false,effectiveEpoch:epoch+1,atMs:now+1});
 assert.deepEqual(readMemberStatus(db,principal,now+DAY_MS).actions.items,[]);
});
test('sealed component presentation delegates minimum and cap to the shared domain and never fills missing evidence',()=>{
 const row={epoch,source_ref:'fixture-source',snapshot_hash:'fixture-snapshot',streak_days:0,payload:JSON.stringify({intervals:[],completions:[],highestEligibleLevel:0,purchaseTokenDays:0})};
 assert.equal(finalizedMemberComponents(null),null);assert.equal(finalizedMemberComponents(row).multiplierTenths,1);
 const full={...row,streak_days:10,payload:JSON.stringify({intervals:Array.from({length:10},(_,i)=>({actionId:String(i),startEpoch:epoch})),
  completions:Array.from({length:10},(_,i)=>({actionId:String(i),verifiedAtMs:now})),highestEligibleLevel:10,purchaseTokenDays:99})};
 assert.equal(finalizedMemberComponents(full).multiplierTenths,100);assert.equal(finalizedMemberComponents(full).sourceRef,'fixture-source');
});
