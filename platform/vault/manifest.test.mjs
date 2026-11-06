import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalJson,utf8} from '../security/canonical.mjs';
import {createNodeCrypto} from '../security/node-crypto.mjs';
import {createVaultLiabilityManifest,verifyVaultLiabilityManifest,projectVaultReserve,publicVaultLiabilityCommitment} from './manifest.mjs';
const crypto=createNodeCrypto(),activatedMs=Date.UTC(2026,10,1),hour=3600000;
const input=()=>({marketId:'synthetic-launch',activatedMs,originalUnits:'402600000',inventoryCommitment:'a'.repeat(64),seasons:[]});
const create=value=>createVaultLiabilityManifest(utf8(canonicalJson(value)),{crypto});

test('compact manifest commits every Genesis obligation before any mint without owner authority',async()=>{
 const result=await create(input()),manifest=await verifyVaultLiabilityManifest(result.bytes,result.sha256,{crypto});
 assert.ok(result.bytes.length<1200);let total=0n,count=0;
 for(let tranche=1;tranche<=10;tranche++)for(let level=1;level<=10;level++)for(let ordinal=0;ordinal<manifest.genesis.levelCounts[level-1];ordinal++){
  const p=projectVaultReserve(manifest,{kind:'genesis',tranche,level,ordinal},activatedMs+48*hour);total+=BigInt(p.allocatedUnits);count++;
  assert.equal(p.claimAuthority,false);assert.equal(p.claimedUnits,null);
 }
 assert.equal(count,10000);assert.equal(total,20130000n);
 const slot={kind:'genesis',tranche:1,level:1,ordinal:0};
 assert.equal(projectVaultReserve(manifest,slot,activatedMs+24*hour).vestedUnits,'0');
 assert.equal(projectVaultReserve(manifest,slot,activatedMs+36*hour).vestedUnits,'500');
 assert.equal(manifest.visibility,'private');assert.equal(manifest.claimHistoryIncluded,false);
});

test('Season snapshots retain original denominator and liability after expiry',async()=>{
 const value=input();value.originalUnits='40040000';value.seasons=[{id:'synthetic-season',startsMs:activatedMs,levels:Array(1000).fill(1)}];value.seasons[0].levels[0]=2;
 const result=await create(value);value.seasons[0].levels[0]=10;
 const m=await verifyVaultLiabilityManifest(result.bytes,result.sha256,{crypto}),slot={kind:'season',seasonId:'synthetic-season',slotIndex:0};
 assert.equal(m.season.activeWeight,'1001');assert.equal(projectVaultReserve(m,slot,activatedMs+36*hour).vestedUnits,'1000');
 assert.equal(projectVaultReserve(m,slot,activatedMs+365*24*hour).vestedUnits,'2000');
});

test('tampered and internally inconsistent manifests and incomplete inventories are rejected',async()=>{
 const r=await create(input()),changed=JSON.parse(new TextDecoder().decode(r.bytes));changed.genesis.budgetUnits='1';const bytes=utf8(canonicalJson(changed));
 await assert.rejects(verifyVaultLiabilityManifest(bytes,r.sha256,{crypto}),/digest/);
 await assert.rejects(verifyVaultLiabilityManifest(bytes,await crypto.sha256(bytes),{crypto}),/liabilities/);
 await assert.rejects(create({...input(),seasons:[{id:'bad',startsMs:activatedMs,levels:[1]}]}));
 await assert.rejects(create({...input(),originalUnits:'201'}));
 await assert.rejects(create({...input(),extra:true}));
});

test('public commitment exposes budgets and pins without private Season levels or reserve assignments',async()=>{
 const value=input();value.seasons=[{id:'synthetic-private-season',startsMs:activatedMs,levels:Array(1000).fill(3)}];
 const r=await create(value),pub=await publicVaultLiabilityCommitment(r.bytes,r.sha256,{crypto});
 assert.equal(pub.genesisReservedSlots,10000);assert.equal(pub.seasonReservedSlots,1000);assert.equal(pub.liabilityDigest,r.sha256);
 assert.equal(BigInt(pub.genesisBudgetUnits)+BigInt(pub.seasonBudgetUnits),BigInt(value.originalUnits)/20n);
 assert.equal(pub.claimFormat,'not-a-program-merkle-proof');assert.equal(pub.isAuthorization,false);
 assert.doesNotMatch(JSON.stringify(pub),/synthetic-private-season|levels|snapshots|owner|ordinal/);
});
